# wafergraph-mcp

A remote MCP server exposing [wafergraph.com](https://wafergraph.com)'s semiconductor & AI
supply-chain dataset — 565 companies across 12 segments, the supplier/customer graph, and a
74-deal M&A corpus — as five read-only tools any MCP-speaking AI agent can call directly.

No auth, no cost, read-only. Streamable HTTP transport at `/mcp`. Human landing page at `/`.

Live: **https://wafergraph-mcp.jwpalm99.workers.dev**

## Tools

| Tool | Purpose |
|---|---|
| `search_companies({query?, segment?, country?})` | Name/description search with segment & country filters. Compact list, capped at 25, with a total match count. |
| `get_company({id})` | Full allowed profile for one company (by id or name) plus its supplier/customer edges. |
| `get_segments()` | The 12-segment taxonomy (+ subsegments, market_position enum) with live company counts. |
| `get_supply_chain({id, direction, depth})` | Walk the supplier/customer graph from a focal company up to 2 tiers up (`"up"`), down (`"down"`), or `"both"`. |
| `get_deals({query?, segment?})` | Search the M&A deal corpus. Compact list, capped at 30, with a total match count. |

Every response includes:
- `data` — the payload.
- `attribution` — compiled-by/sources block (SEC, Wikidata, Wikipedia, GLEIF) plus a
  `company_url` back to the full sourced profile on wafergraph.com.
- `links` — `{ report, newsletter }` pointing back to wafergraph.com and its $99 report.

### Field discipline

Company records intentionally exclude `key_products`. That field in wafergraph's own dataset
was bulk-drafted and has a known fabrication/mis-scope history that hasn't finished a verified
re-fill pass (tracked in the wafergraph repo's own `CLAUDE.md`). Every other field shipped here
(`name`, `ticker`, `market_cap_usd_b`, `segments`, `one_liner`, `market_position`,
`key_customers`/`key_suppliers` graph edges, deals) is the established, trust-checked data. The
exclusion point is marked with a code comment in `src/types.ts` (`toAllowedCompany`) — re-enable
once wafergraph ships the verified deep-fill.

## Install

### Claude Code

```
claude mcp add --transport http wafergraph https://wafergraph-mcp.jwpalm99.workers.dev/mcp
```

### claude.ai (custom connector)

Settings → Connectors → Add custom connector → paste:

```
https://wafergraph-mcp.jwpalm99.workers.dev/mcp
```

### Generic MCP client (Streamable HTTP)

```json
{
  "mcpServers": {
    "wafergraph": {
      "url": "https://wafergraph-mcp.jwpalm99.workers.dev/mcp"
    }
  }
}
```

## Architecture

Cloudflare Worker, TypeScript, built on the `agents` package's `McpAgent` (Durable-Object-backed
Streamable HTTP MCP server — free on the Workers Free plan; SQLite storage backend). See
`CLAUDE.md` for the file map and the data-source-mode decision (hybrid live-fetch + one
vendored snapshot, discovered by E2E-testing the upstream endpoints rather than assumed).

## Development

```bash
npm install
npm run dev       # wrangler dev, local
npm run typecheck # tsc --noEmit
npm run deploy    # wrangler deploy
```

## Attribution & licensing

See `ATTRIBUTION.md` for the full source/license breakdown (SEC EDGAR public domain, Wikidata
CC0, Wikipedia CC BY-SA 4.0 — attribution required, GLEIF). Short version: free to use, credit
wafergraph.com, not financial advice.

This is an independent project built against wafergraph.com's public dataset; it is not an
official wafergraph product.
