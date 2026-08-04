# mcp-hilma

Hilma MCP — Finnish government public procurement notices (keyed).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Hilma data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
