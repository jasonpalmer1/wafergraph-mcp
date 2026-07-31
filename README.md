# wafergraph-mcp

A remote MCP server exposing [wafergraph.com](https://wafergraph.com)'s semiconductor & AI
supply-chain dataset — 565 companies across 12 segments, the supplier/customer graph, and a
74-deal M&A corpus — as 30 read-only tools any MCP-speaking AI agent can call directly.

No auth, no cost, read-only. Streamable HTTP transport at `/mcp`. Human landing page at `/`.

Live: **https://mcp.wafergraph.com**

## Tools

| Tool | Purpose |
|---|---|
| `search_companies({query?, segment?, country?})` | Name/description search with segment & country filters. Compact list, capped at 25, with a total match count. |
| `get_company({id})` | Full allowed profile for one company (by id or name) plus its supplier/customer edges. |
| `get_segments()` | The 12-segment taxonomy (+ subsegments, market_position enum) with live company counts. |
| `get_supply_chain({id, direction, depth})` | Walk the supplier/customer graph from a focal company up to 2 tiers up (`"up"`), down (`"down"`), or `"both"`. |
| `get_deals({query?, segment?})` | Search the M&A deal corpus. Compact list, capped at 30, with a total match count. |
| `compare_companies({ids})` | Side-by-side comparison of 2-6 companies on aligned fields, plus their shared and unique supply-chain counterparties. |
| `get_country_exposure({segment?})` | Geographic concentration: which countries host a segment's companies, ranked by count, with disclosed market-cap coverage. |
| `find_chokepoints({segment?, limit?})` | Rank chokepoints by downstream dependency weighted by market position. Transparent heuristic, not a proprietary risk model. |
| `analyze_portfolio_exposure({holdings})` | Map tickers or ids to segment/country exposure and flag suppliers that several holdings share. Not investment advice. |

### Screening & discovery

| Tool | Purpose |
|---|---|
| `filter_companies({...})` | Structured multi-criteria screen (segment, subsegment, country, position, public, market-cap band, has_ticker) with sorting and pagination. |
| `list_subsegments({segment?})` | Every subsegment with its live company count and parent segment. |
| `get_subsegment({segment, subsegment})` | All companies in one subsegment with position and country breakdowns. |
| `find_similar_companies({id})` | Nearest structural neighbours by Jaccard similarity over segment tags and shared supply-chain counterparties. |
| `rank_by_market_cap({segment?, country?, limit?})` | Largest companies by disclosed market cap, always with its coverage ratio. |
| `resolve_ticker({inputs})` | Batch-resolve up to 25 tickers, names, or ids to canonical companies, with suggestions on a miss. |

### Geography & structure

| Tool | Purpose |
|---|---|
| `list_countries({segment?})` | Every country with company counts, segment mix, and public/private split. |
| `get_country_profile({country})` | One country in depth, including how many supply relationships cross its border in each direction. |
| `compare_countries({countries})` | 2-5 countries side by side, with uniquely-present and dominant segments. |
| `get_segment_leaders({segment?})` | Who occupies the monopoly and leader positions in a segment. |
| `get_upstream_concentration({id})` | One company's supplier mix by country and segment with an HHI index and edge-coverage context. |

### Graph analysis

| Tool | Purpose |
|---|---|
| `find_paths_between({from, to, max_depth?})` | Documented supply paths between two companies, shortest first. |
| `simulate_disruption({company_id? | country? | segment?})` | Blast radius if a company, country, or segment goes offline, ranking those left with no documented alternative. |
| `find_single_source_dependencies({segment?, country?})` | Customer/subsegment pairs served by exactly one documented supplier. |
| `rank_by_connectivity({metric?, limit?})` | Rank by documented degree. Measures documentation density, not real-world criticality. |
| `find_common_suppliers({ids? | segment?})` | Suppliers shared across an arbitrary set of companies, with the share of the set each serves. |

### Deals & dataset

| Tool | Purpose |
|---|---|
| `get_deal({id})` | One M&A deal in full, with parties resolved to companies where possible. |
| `find_deals_by_company({id})` | Every deal a company took part in, split by role, with the match method exposed. |
| `get_ma_activity_summary()` | Deal counts and disclosed values by year, type, and status. |
| `find_consolidation_hotspots()` | Which segments are consolidating, with unresolvable deals counted rather than dropped. |
| `get_dataset_stats()` | What this dataset contains, how fresh it is, and where it is thin. Call it to learn what the data cannot answer. |

Every response includes:
- `data` — the payload.
- `attribution` — compiled-by/sources block (SEC, Wikidata, Wikipedia, GLEIF) plus a
  `company_url` back to the full sourced profile on wafergraph.com.
- `links` — `{ report, newsletter }` pointing back to wafergraph.com and its hand-scored
  Vendor Exposure Review.

### Field discipline

Company records include `key_products` as of 2026-07-19. That field in wafergraph's own dataset
was originally bulk-drafted with a known fabrication/mis-scope history and was withheld here
until a verified deep-fill landed upstream; it now has (confirmed live) 564/565 companies filled,
with only `sk_enpulse` empty (defunct, absorbed into SKC 2025-12-23). Every field shipped here —
`name`, `ticker`, `market_cap_usd_b`, `segments`, `one_liner`, `market_position`, `key_products`,
`key_customers`/`key_suppliers` graph edges, deals — is established, trust-checked data. Fields
are still whitelisted (not blacklisted) in `src/types.ts` (`toAllowedCompany`), so anything added
upstream later stays excluded by default until deliberately added.

### What this server records

Counters only, never identities. No IPs, no query contents or tool arguments, no user
identifiers, no cookies, no PII. Specifically: how many times each tool was called per day, how
many distinct sessions opened per day, and which client *software* connected (the `clientInfo`
name and version your MCP client already sends in the `initialize` handshake, e.g.
`claude-code@2.1.0`).

Sessions are not users — one person reconnecting counts several times. Nothing recorded here can
identify who you are.

## Install

### Claude Code

```
claude mcp add --transport http wafergraph https://mcp.wafergraph.com/mcp
```

### claude.ai (custom connector)

Settings → Connectors → Add custom connector → paste:

```
https://mcp.wafergraph.com/mcp
```

### Generic MCP client (Streamable HTTP)

```json
{
  "mcpServers": {
    "wafergraph": {
      "url": "https://mcp.wafergraph.com/mcp"
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
