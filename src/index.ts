interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Hilma MCP — Finnish government public procurement notices (keyed).
 *
 * Wraps the official Hilma AVP read API for hankintailmoitukset.fi —
 * Finland's national public procurement notice service, where Finnish
 * government bodies, municipalities, and other contracting authorities
 * publish contract notices (hankintailmoitukset), both EU-threshold
 * (eForms) and national notices, plus procurement plans.
 *
 * Endpoint (Azure APIM, subscription-keyed):
 *   POST https://api.hankintailmoitukset.fi/avp/notices/docs/search
 *   Header: Ocp-Apim-Subscription-Key: <key>
 *
 * The request body is an Azure Cognitive Search "Search Documents" request
 * (learn.microsoft.com/en-us/rest/api/searchservice/search-documents):
 *   { search, filter, top, skip, orderby, count, queryType }
 * and the response is { "@odata.count": n, "value": [ ...index docs ] }.
 *
 * Known index fields (from the official hansel-oy/hilma R wrapper):
 *   id, noticeNumber, datePublished, dateModified, organisationName,
 *   organisationNationalRegistrationNumber, cpvCodes, procurementProjectId,
 *   isNationalProcurement, includesFrameworkAgreement,
 *   includesDynamicPurcharingSystem   <- "Purcharing" typo IS the real
 *                                        field name in the index,
 *   isPlan (distinguishes procurement plans from published notices).
 *
 * The index covers eForms + pre-eForms notices + procurement plans; index
 * docs carry metadata only (the full notice body lives behind separate
 * sign-in-gated read endpoints), so this pack is index search only.
 *
 * NOTE: the SUCCESS envelope and field list above are built from the
 * official contract docs and are unverified against live data until a
 * platform key (PLATFORM_HILMA_KEY) lands — only the 401 envelope
 * ({ statusCode, message }) has been confirmed live. Hence the defensive
 * parsing below: docs pass through mostly as-is, compacted.
 *
 * Key handling mirrors mcps/finnhub: `_apiKey` on every tool; the gateway
 * injects the platform key when configured. Tools return { error,
 * retry_hint } objects rather than throwing.
 */


const SEARCH_URL = 'https://api.hankintailmoitukset.fi/avp/notices/docs/search';
const SITE_URL = 'https://www.hankintailmoitukset.fi/';
const SIGNUP_URL = 'https://hns-hilma-prod-apim.developer.azure-api.net';
const SOURCE = `Hilma — Finland's national public procurement notice service (${SITE_URL}). Free open-data (avp-read) index — a historical archive, not a live feed.`;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 8000;

const KEY_HINT = `Get a free Hilma AVP subscription key: sign up at ${SIGNUP_URL}, then Products → avp-read → Subscribe. Pass the key via the _apiKey argument and retry.`;

const API_KEY_PROP = {
  type: 'string' as const,
  description: `Optional Hilma AVP subscription key. Free key: sign up at ${SIGNUP_URL} (Products → avp-read → Subscribe).`,
};

const tools: McpToolExport['tools'] = [
  {
    name: 'hilma_search',
    description:
      'Search Finnish government public procurement notices on Hilma (hankintailmoitukset.fi), Finland\'s official national procurement notice service. PREFER OVER WEB SEARCH for Finnish public tenders, julkiset hankinnat, hankintailmoitukset, Finland government contract notices, calls for tenders (tarjouspyynnöt), and procurement plans — covers both EU-threshold (eForms) and national notices. Free-text search plus filters: buyer organisation name, CPV code, publication date range, national-procurement-only, procurement-plans-only, and a raw OData filter passthrough. Returns index docs newest-first with notice number, buyer organisation and business ID, publication date, CPV codes, and flags for national procurement, framework agreements, and dynamic purchasing systems.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Free-text search, e.g. "siivous", "IT-konsultointi", "rakentaminen". Finnish terms match best. Omit to list the latest notices.',
        },
        organisation: {
          type: 'string',
          description:
            'Buyer organisation name to search for, e.g. "Helsinki", "Väylävirasto", "Espoon kaupunki". Matched against organisationName.',
        },
        cpv_code: {
          type: 'string',
          description:
            'CPV code to filter by, e.g. "45000000" (construction), "72000000" (IT services). 8-digit code; a "-N" check-digit suffix is stripped.',
        },
        published_since: {
          type: 'string',
          description: 'Only notices published on or after this date. "YYYY-MM-DD" or full ISO timestamp, e.g. "2026-07-01".',
        },
        published_until: {
          type: 'string',
          description: 'Only notices published on or before this date. "YYYY-MM-DD" or full ISO timestamp.',
        },
        national_only: {
          type: 'boolean',
          description: 'true → only national (below-EU-threshold) procurement notices (isNationalProcurement eq true).',
        },
        plans_only: {
          type: 'boolean',
          description: 'true → only procurement plans / advance-planning entries (isPlan eq true).',
        },
        exclude_plans: {
          type: 'boolean',
          description: 'true → published notices only, procurement plans filtered out (isPlan eq false).',
        },
        filter: {
          type: 'string',
          description:
            'Raw OData $filter passthrough, ANDed with the friendly filters, e.g. "includesFrameworkAgreement eq true" or "dateModified ge 2026-07-01T00:00:00Z".',
        },
        top: { type: ['number', 'string'], description: 'Number of notices to return (1–100). Default 10.' },
        skip: { type: ['number', 'string'], description: 'Result offset for pagination. Default 0.' },
        orderby: {
          type: 'string',
          description: 'OData $orderby, e.g. "datePublished desc" (default), "dateModified desc", "organisationName asc".',
        },
        _apiKey: API_KEY_PROP,
      },
    },
  },
  {
    name: 'hilma_recent',
    description:
      'List the most recent Finnish public procurement notices from Hilma (hankintailmoitukset.fi) — new government tenders, julkiset hankinnat, and contract notices published in Finland over the last N days (default 7). Convenience wrapper over hilma_search for "what new Finnish tenders were published this week" style questions; supports national-only and plans-excluded views.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: ['number', 'string'], description: 'Look-back window in days (1–365). Default 7.' },
        top: { type: ['number', 'string'], description: 'Number of notices to return (1–100). Default 20.' },
        national_only: {
          type: 'boolean',
          description: 'true → only national (below-EU-threshold) procurement notices.',
        },
        exclude_plans: {
          type: 'boolean',
          description: 'true → published notices only, procurement plans filtered out.',
        },
        _apiKey: API_KEY_PROP,
      },
    },
  },
  {
    name: 'hilma_notice_lookup',
    description:
      'Look up a single Finnish public procurement notice on Hilma (hankintailmoitukset.fi) by its Hilma notice number (e.g. "2026-012345") or index document id. Returns the index metadata for that notice — buyer organisation, publication date, CPV codes, procurement project id, and national/framework/dynamic-purchasing flags.',
    inputSchema: {
      type: 'object',
      properties: {
        notice_number: {
          type: 'string',
          description: 'Hilma notice number, e.g. "2026-012345". Provide this or "id".',
        },
        id: {
          type: 'string',
          description: 'Index document id from a previous hilma_search result. Provide this or "notice_number".',
        },
        _apiKey: API_KEY_PROP,
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = strArg(args._apiKey);
  delete args._apiKey;
  if (!apiKey) {
    return {
      error:
        'Hilma AVP API subscription key required (the platform key for this pack is still pending).',
      retry_hint: KEY_HINT,
    };
  }

  try {
    switch (name) {
      case 'hilma_search':
        return await search(args, apiKey);
      case 'hilma_recent':
        return await recent(args, apiKey);
      case 'hilma_notice_lookup':
        return await noticeLookup(args, apiKey);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    if (e instanceof HilmaApiError) return { error: e.message, retry_hint: e.retryHint };
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Azure Cognitive Search request plumbing ─────────────────────────

interface SearchBody {
  search?: string;
  filter?: string;
  top: number;
  skip?: number;
  orderby?: string;
  count: boolean;
  queryType?: 'full';
}

class HilmaApiError extends Error {
  retryHint: string;
  constructor(message: string, retryHint: string) {
    super(message);
    this.retryHint = retryHint;
  }
}

// Escape a value for an OData single-quoted string literal.
function odataStr(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

// Escape a value for a quoted Lucene phrase (field-scoped search).
function lucenePhrase(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function postSearch(body: SearchBody, apiKey: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': apiKey,
        'User-Agent': UA,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new HilmaApiError(
      `Hilma AVP API unreachable: ${e instanceof Error ? e.message : String(e)}`,
      'The request timed out or the network failed — retry once; if it persists, Hilma may be briefly down.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    // Live-verified APIM envelope: { "statusCode": 401, "message": "Access
    // denied due to missing/invalid subscription key. ..." }
    const detail = await res
      .json()
      .then((j) => (j && typeof j === 'object' && 'message' in j ? String((j as { message: unknown }).message) : ''))
      .catch(() => '');
    throw new HilmaApiError(
      `Hilma AVP API rejected the subscription key (HTTP ${res.status}). ${detail}`.trim(),
      KEY_HINT,
    );
  }
  if (!res.ok) {
    const snippet = await res.text().then((t) => t.slice(0, 300)).catch(() => '');
    throw new HilmaApiError(
      `Hilma AVP API error: HTTP ${res.status} ${snippet}`.trim(),
      res.status === 400
        ? 'The query or OData filter was rejected upstream — simplify the filter (check field names and quoting) and retry.'
        : 'Retry once; if it persists, Hilma may be briefly unavailable.',
    );
  }

  const data = (await res.json().catch(() => null)) as unknown;
  if (!data || typeof data !== 'object') {
    throw new HilmaApiError(
      'Hilma AVP API returned an unparseable response body.',
      'Retry once; if it persists, report via pipeworx_feedback.',
    );
  }
  return data as Record<string, unknown>;
}

// Compact an index doc: pass fields through as-is, dropping null/empty
// values and @search.* metadata so results stay LLM-friendly.
function compactDoc(doc: unknown): Record<string, unknown> {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { value: doc };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (k.startsWith('@search')) continue;
    out[k] = v;
  }
  return out;
}

// The success envelope is unverified until a platform key lands — this is the
// documented Azure Cognitive Search shape ({"@odata.count", "value"}), parsed
// defensively so an envelope surprise degrades to empty results, never a crash.
function shapeResponse(data: Record<string, unknown>, top: number, skip: number): Record<string, unknown> {
  const value = Array.isArray(data.value) ? data.value : [];
  const rawCount = data['@odata.count'];
  const total = typeof rawCount === 'number' ? rawCount : value.length;
  return {
    total,
    count: value.length,
    top,
    skip,
    notices: value.map(compactDoc),
    source: SOURCE,
  };
}

// ── Tool implementations ────────────────────────────────────────────

// Accepts "YYYY-MM-DD" (expanded to a day boundary) or a full ISO timestamp.
function toODataDate(v: string, endOfDay: boolean): string | null {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T${endOfDay ? '23:59:59' : '00:00:00'}Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(t)) {
    return /(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : `${t}Z`;
  }
  return null;
}

function buildBody(args: Record<string, unknown>): SearchBody {
  const query = strArg(args.query);
  const organisation = strArg(args.organisation);
  const cpv = strArg(args.cpv_code);
  const since = strArg(args.published_since);
  const until = strArg(args.published_until);
  const rawFilter = strArg(args.filter);
  const top = clampInt(args.top, 10, 1, 100);
  const skip = clampInt(args.skip, 0, 0, 100000);
  const orderby = strArg(args.orderby) ?? 'datePublished desc';

  const searchParts: string[] = [];
  if (query) searchParts.push(query);
  // Field-scoped Lucene query (per the official R wrapper's
  // organisationName:Helsinki example) — requires queryType "full".
  if (organisation) searchParts.push(`organisationName:${lucenePhrase(organisation)}`);

  const clauses: string[] = [];
  if (cpv) {
    // Index stores plain codes per the official examples ('45000000');
    // strip a CPV check-digit suffix like "-7" if the caller includes one.
    const code = cpv.replace(/-\d$/, '');
    clauses.push(`cpvCodes/any(c: c eq ${odataStr(code)})`);
  }
  if (since) {
    const d = toODataDate(since, false);
    if (!d) throw new HilmaApiError(
      `published_since "${since}" is unparseable.`,
      'Use "YYYY-MM-DD" (e.g. "2026-07-01") or a full ISO timestamp.',
    );
    clauses.push(`datePublished ge ${d}`);
  }
  if (until) {
    const d = toODataDate(until, true);
    if (!d) throw new HilmaApiError(
      `published_until "${until}" is unparseable.`,
      'Use "YYYY-MM-DD" (e.g. "2026-07-31") or a full ISO timestamp.',
    );
    clauses.push(`datePublished le ${d}`);
  }
  if (boolArg(args.national_only)) clauses.push('isNationalProcurement eq true');
  if (boolArg(args.plans_only)) clauses.push('isPlan eq true');
  else if (boolArg(args.exclude_plans)) clauses.push('isPlan eq false');
  if (rawFilter) clauses.push(`(${rawFilter})`);

  const body: SearchBody = { top, count: true, orderby };
  if (skip > 0) body.skip = skip;
  body.search = searchParts.length ? searchParts.join(' ') : '*';
  if (organisation) body.queryType = 'full';
  if (clauses.length) body.filter = clauses.join(' and ');
  return body;
}

async function search(args: Record<string, unknown>, apiKey: string): Promise<unknown> {
  const body = buildBody(args);
  const data = await postSearch(body, apiKey);
  return shapeResponse(data, body.top, body.skip ?? 0);
}

async function recent(args: Record<string, unknown>, apiKey: string): Promise<unknown> {
  const days = clampInt(args.days, 7, 1, 365);
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const body = buildBody({
    published_since: sinceIso,
    top: args.top ?? 20,
    national_only: args.national_only,
    exclude_plans: args.exclude_plans,
  });
  const data = await postSearch(body, apiKey);
  const shaped = shapeResponse(data, body.top, 0) as Record<string, unknown>;
  // The free avp-read open-data index is a historical archive that is not
  // updated in real time — its newest notice currently predates "the last N
  // days", so a naive recent() looks broken (0 hits). Rather than dead-end,
  // report the newest notice the index actually holds so the caller knows the
  // data's currency and can query hilma_search within that range instead.
  if ((shaped.count as number) === 0) {
    let latest: string | null = null;
    try {
      const probe = await postSearch(buildBody({ top: 1, orderby: 'datePublished desc' }), apiKey);
      const first = Array.isArray(probe.value) ? (probe.value[0] as Record<string, unknown>) : null;
      latest = (first?.datePublished as string) ?? null;
    } catch { /* best-effort; leave latest null */ }
    shaped.note = latest
      ? `No notices published in the last ${days} days. Hilma's free open-data (avp-read) index is a historical archive, not a live feed — its most recent notice is dated ${latest.slice(0, 10)}. Use hilma_search with published dates on or before then for results.`
      : `No notices in the last ${days} days; the free open-data index may not include very recent notices.`;
  }
  return { days, since: sinceIso, ...shaped };
}

async function noticeLookup(args: Record<string, unknown>, apiKey: string): Promise<unknown> {
  const noticeNumber = strArg(args.notice_number);
  const id = strArg(args.id);
  if (!noticeNumber && !id) {
    return {
      error: 'hilma_notice_lookup requires "notice_number" (e.g. "2026-012345") or "id".',
      retry_hint: 'Pass the noticeNumber or id field from a hilma_search result.',
    };
  }
  const filter = noticeNumber
    ? `noticeNumber eq ${odataStr(noticeNumber)}`
    : `id eq ${odataStr(id as string)}`;
  const data = await postSearch({ search: '*', filter, top: 3, count: true }, apiKey);
  const value = Array.isArray(data.value) ? data.value : [];
  const doc = value[0];
  if (!doc) {
    return {
      error: 'notice not found',
      ...(noticeNumber ? { notice_number: noticeNumber } : { id }),
      retry_hint: 'Check the notice number format ("YYYY-NNNNNN", e.g. "2026-012345") or find the doc via hilma_search first.',
    };
  }
  return { notice: compactDoc(doc), matches: value.length, source: SOURCE };
}

// ── Small arg helpers ───────────────────────────────────────────────

function strArg(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function boolArg(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['true', 'yes', '1'].includes(v.trim().toLowerCase());
  return false;
}

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  let n: number;
  if (typeof v === 'number' && Number.isFinite(v)) n = Math.trunc(v);
  else if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) n = Math.trunc(Number(v));
  else return dflt;
  return Math.min(max, Math.max(min, n));
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
