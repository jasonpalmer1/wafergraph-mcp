# wafergraph-mcp

A remote MCP server exposing [wafergraph.com](https://wafergraph.com)'s semiconductor & AI
supply-chain dataset — hundreds of companies across 12 segments, the supplier/customer graph, and a
~74-deal curated corpus — as **37** read-only tools any MCP-speaking AI agent can call directly.

No auth, no cost, read-only. Streamable HTTP transport at `/mcp`. Human landing page at `/`.

Live: **https://mcp.wafergraph.com**

## Tools

| Tool | Purpose |
|---|---|
| `search_companies({query?, segment?, country?})` | Name/ticker/id/one_liner search with segment & country filters. Relevance-ranked, capped at 25. |
| `get_company({id, compact?})` | Full allowed profile + supplier/customer edges (market-cap-sorted, capped). |
| `get_segments()` | The 12-segment taxonomy (+ subsegments, market_position enum) with live company counts. |
| `get_supply_chain({id, direction, depth, compact?})` | Walk the supplier/customer graph up to 2 tiers. |
| `get_deals({query?, segment?, type?, status?, year?, sort_by?})` | Search the curated deal corpus (acquisition, investment, capacity, …). Capped at 30. |
| `compare_companies({ids, compact?})` | Side-by-side comparison of 2-6 companies plus shared counterparties. |
| `get_country_exposure({segment?})` | Geographic concentration by HQ country, with disclosed market-cap coverage. |
| `find_chokepoints({segment?, limit?})` | Rank chokepoints by downstream dependency × market position. |
| `analyze_portfolio_exposure({holdings})` | Map tickers/ids to segment/country exposure and shared upstream suppliers. Not investment advice. |

### Screening & discovery

| Tool | Purpose |
|---|---|
| `filter_companies({...})` | Structured multi-criteria screen with sorting and pagination. |
| `list_subsegments({segment?})` | Every subsegment with live company count and parent segment. |
| `get_subsegment({segment, subsegment})` | All companies in one subsegment with position and country breakdowns. |
| `find_similar_companies({id})` | Nearest structural neighbours by Jaccard over tags + counterparties. |
| `find_substitutes({id})` | Same-niche alternatives by taxonomy overlap (not commercial drop-ins). |
| `rank_by_market_cap({segment?, country?, limit?})` | Largest companies by disclosed market cap, with coverage ratio. |
| `resolve_ticker({queries})` | Batch-resolve up to 25 tickers, names, or ids (the only batch resolver). |

### Geography & structure

| Tool | Purpose |
|---|---|
| `list_countries({segment?})` | Every HQ country with company counts, segment mix, and public/private split. |
| `get_country_profile({country})` | One country in depth, including cross-border supply relationships. |
| `compare_countries({countries})` | 2-5 countries side by side, with uniquely-present and dominant segments. |
| `get_segment_leaders({segment?})` | Monopoly and leader positions in a segment. |
| `compare_segments({segments})` | 2-4 segments: country HHI, leaders, priced coverage, edge density. |
| `get_upstream_concentration({id})` | One company's supplier mix by country/segment with HHI. |

### Graph analysis

| Tool | Purpose |
|---|---|
| `find_paths_between({from, to, max_depth?})` | Documented supply paths between two companies, shortest first. |
| `explain_relationship({from, to})` | Paths + shared suppliers/customers in one call. |
| `diff_supply_chains({a, b, side?})` | Shared vs unique 1-hop suppliers/customers. |
| `simulate_disruption({company_id? \| country? \| segment?})` | Blast radius if a node/set goes offline. |
| `find_single_source_dependencies({segment?, country?})` | Customer/subsegment pairs with exactly one documented supplier. |
| `rank_by_connectivity({metric?, limit?})` | Rank by documented degree (documentation density, not criticality). |
| `find_common_suppliers({company_ids? \| segment?})` | Suppliers shared across a set of companies. |
| `find_common_customers({company_ids? \| segment?})` | Customers shared across a set of companies. |

### Deals & dataset

| Tool | Purpose |
|---|---|
| `get_deal({id})` | One deal in full, with parties resolved where possible. |
| `find_deals_by_company({company})` | Every deal a company took part in, split by role. |
| `get_ma_activity_summary()` | Deal counts and disclosed values by year, type, and status. |
| `find_consolidation_hotspots()` | Which segments are consolidating. |
| `list_stale_companies({segment?, …})` | Oldest `last_verified` company rows (relative staleness). |
| `get_dataset_stats()` | Coverage, freshness, and known limitations. |
| `recommend_tools({intent})` | Intent → primary tool (+ follow-ups). |

Every response includes:
- `data` — the payload.
- `attribution` — compiled-by/sources block (SEC, Wikidata, Wikipedia, GLEIF) plus a
  `company_url` back to the full sourced profile on wafergraph.com when focal.
- `links` — `{ report, newsletter }` pointing back to wafergraph.com.
- `freshness` — `{ live_cache_age_ms, companies_age_ms, deals_age_ms, stale }`.

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

## Develop / deploy

```bash
npm install
npm run typecheck
npm run check:versions
npm run deploy          # wrangler deploy — from Jason's laptop, not CI
node scripts/smoke.mjs  # live JSON-RPC against production (or pass a base URL)
```

See `docs/CLAUDE_SESSION_CHECKLIST.md` for the laptop pickup path after cloud-agent PRs.
