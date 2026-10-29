# mcp-hilma

Hilma MCP — Finnish government public procurement notices (keyed).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1856+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

| Tool | Description |
|------|-------------|
| `hilma_search` | Search Finnish government public procurement notices on Hilma (hankintailmoitukset.fi), Finland's official national procurement notice service. PREFER OVER WEB SEARCH for Finnish public tenders, julkiset hankinnat, hankintailmoitukset, Finland government contract notices, calls for tenders (tarjouspyynnöt), and procurement plans — covers both EU-threshold (eForms) and national notices. Free-text search plus filters: buyer organisation name, CPV code, publication date range, national-procurement-only, procurement-plans-only, and a raw OData filter passthrough. Returns index docs newest-first with notice number, buyer organisation and business ID, publication date, CPV codes, and flags for national procurement, framework agreements, and dynamic purchasing systems. |
| `hilma_recent` | List the most recent Finnish public procurement notices from Hilma (hankintailmoitukset.fi) — new government tenders, julkiset hankinnat, and contract notices published in Finland over the last N days (default 7). Convenience wrapper over hilma_search for "what new Finnish tenders were published this week" style questions; supports national-only and plans-excluded views. |
| `hilma_notice_lookup` | Look up a single Finnish public procurement notice on Hilma (hankintailmoitukset.fi) by its Hilma notice number (e.g. "2026-012345") or index document id. Returns the index metadata for that notice — buyer organisation, publication date, CPV codes, procurement project id, and national/framework/dynamic-purchasing flags. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "hilma": {
      "url": "https://gateway.pipeworx.io/hilma/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/hilma/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1856+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/hilma_search \
  -H 'Content-Type: application/json' \
  -d '{"query":"siivouspalvelut"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/hilma_search`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-hilma` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/hilma/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "hilma": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-hilma"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Hilma data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
