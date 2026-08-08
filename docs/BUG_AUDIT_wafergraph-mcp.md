# wafergraph-mcp — bug audit (2026-08-08)

Full findings for this repository. Cross-repo index: [`../AUDIT_HANDOFF_FOR_CLAUDE.md`](../AUDIT_HANDOFF_FOR_CLAUDE.md).

**Auditor:** Cursor cloud agent `bc-019fe37e-1d17-72d7-8421-1228c564bedb`  
**Live data at audit:** ~615 companies, ~74 deals (tool copy still says 565)  
**Code changes in this pass:** none (documentation only)

---

## Critical

None. No RCE, SSRF, auth bypass, or exploitable KV/HTML injection found for current v1 threat model (public read-only dataset).

---

## High

### H1. `filter_companies`: segment + subsegment filters are independent

- **Where:** `src/tools/screen.ts` — `filter_companies` handler (~81–82)
- **What's wrong:** Segment and subsegment checked with separate `.some()` calls. A multi-segment company matches `segment=A` + `subsegment=B` even when `B` is not under `A` on the same membership.
- **Why it matters:** Live data has many multi-segment companies; screens return false positives. `get_subsegment` does the join correctly.
- **Fix:** When both filters set, require one membership:  
  `c.segments.some(s => s.segment === seg && s.subsegment === sub)`.

### H2. `find_paths_between`: DFS + result cap can miss shorter paths

- **Where:** `src/tools/graphtools.ts` — inner `search()` (~146–173)
- **What's wrong:** Depth-first search stops at `limit`. Neighbor order is arbitrary. Post-sort by length cannot recover paths never collected. A direct edge can be omitted if longer paths fill the cap first.
- **Why it matters:** Tool implies shortest-first usefulness; default limit 10 / depth 3 can omit the documented shortest path.
- **Fix:** BFS (or iterative deepening) by hop length; collect up to `limit` in length order; keep exploration budget separate.

### H3. `simulate_disruption`: schema says ticker; code does not resolve tickers

- **Where:** `src/tools/graphtools.ts` — `simulate_disruption` (~247–278)
- **What's wrong:** `company_id` describe text: “id, name, or ticker”. Resolution uses `findCompany()` only. Sibling tools use `resolveCompany()` with ticker map.
- **Why it matters:** `company_id: "TSM"` / `"NVDA"` fails after agents learn tickers work elsewhere.
- **Fix:** `resolveCompany(graph, byTicker, company_id)`.

---

## Medium

### M1. Stale in-memory cache discarded on refresh failure

- **Where:** `src/data.ts` — `getCompanies` / `getDeals`
- **What's wrong:** After TTL expiry, failed fetch throws even if a previous cache entry exists.
- **Fix:** On fetch failure, return stale cache if present (optionally flag `stale: true`); throw only when empty.

### M2. No in-flight fetch coalescing

- **Where:** `src/data.ts`
- **What's wrong:** Concurrent past-TTL callers each hit origin.
- **Fix:** Module-level `inflight` promise shared until settled.

### M3. Hardcoded “565 companies” is stale

- **Where:** `src/mcp-agent.ts`, `src/tools/screen.ts`, `src/tools/geo.ts`, `src/landing.ts`, `CLAUDE.md`, tool descriptions
- **What's wrong:** Live `companies.json` ~615.
- **Fix:** Soften copy (“hundreds of companies”) or use live `companies.length` in responses; stop hardcoding in descriptions.

### M4. Country alias handling inconsistent

- **Where:** Aliases in `src/tools/geo.ts` (`COUNTRY_ALIASES`); absent in `filter_companies`, `search_companies`, `get_country_exposure`, `simulate_disruption`, etc.
- **What's wrong:** `get_country_profile("USA")` works; `filter_companies({ country: "USA" })` empty.
- **Fix:** Shared `normalizeCountryQuery` / `resolveCountry` everywhere country is input.

### M5. `compare_companies` promises unique counterparties

- **Where:** `src/mcp-agent.ts` description vs payload (~330–385)
- **What's wrong:** Description mentions shared *and* unique; payload only `shared_suppliers` / `shared_customers`.
- **Fix:** Add unique lists or shrink the description.

### M6. Portfolio segment `share` can exceed 100% in aggregate

- **Where:** `src/mcp-agent.ts` — `analyze_portfolio_exposure` `tally()` with `flatMap` over segments
- **What's wrong:** Multi-segment holdings increment multiple buckets; `share = count / matched.length`.
- **Fix:** Document as “% of holdings that touch this segment”, or weight by 1/|segments|.

### M7. `rank_by_market_cap` can return unpriced companies

- **Where:** `src/tools/screen.ts` (~407–408)
- **What's wrong:** Null caps sort last but still fill `limit`.
- **Fix:** Rank only priced companies (coverage already returned).

### M8. `find_common_suppliers` silent input truncation

- **Where:** `src/tools/graphtools.ts` — `INPUT_CAP = 15` (~673–679)
- **What's wrong:** Analysis may use full segment; response lists 15 companies with no truncation note.
- **Fix:** Add note when truncated (same pattern as edge caps).

### M9. `walkChain(..., "both")` upstream-wins on two-way ties

- **Where:** `src/graph.ts` (~101–130)
- **What's wrong:** Shared `tier` map; firm that is both supplier and customer of focal is only upstream; downstream walk skips it.
- **Fix:** Dual membership / independent walks, or document upstream-preferring semantics.

### M10. `await recordUsage(...)` on every tool call

- **Where:** All tools in `mcp-agent.ts` and `src/tools/*`
- **What's wrong:** Telemetry awaited before work; session start correctly uses `void`. KV latency becomes MCP latency.
- **Fix:** `void recordUsage(...)`.

### M11. `get_deals` segment filter ignores null-id parties

- **Where:** `src/mcp-agent.ts` `get_deals` vs `src/tools/deals.ts` name-fallback
- **What's wrong:** Segment match requires `p.id` + `byId.get`; null-id parties skipped. Other deal tools name-match.
- **Fix:** Reuse `resolvePartyCompany` (or equivalent).

### M12. Unauthenticated expensive graph tools (cost / DoS)

- **Where:** `find_paths_between`, `find_similar_companies`, `find_common_suppliers`, `simulate_disruption`
- **What's wrong:** Public, no rate limits (intentional v1), CPU-heavy.
- **Fix:** Tighter caps, BFS, per-IP/DO limits, cache graph builds — when/if abuse appears.

---

## Low

| ID | Where | Issue | Fix direction |
|---|---|---|---|
| L1 | `mcp-agent.ts` vs `tools/shared.ts` | Duplicate `companyRef` shapes (country omitted in agent-local) | One shared helper |
| L2 | Several company tools | Ticker resolution inconsistent (`get_company`, `get_supply_chain`, …) | Shared resolver or explicit “no tickers” in every schema |
| L3 | `search_companies` / `get_deals` | Assume string fields always present; one bad upstream row can crash | Optional chaining / defaults after fetch |
| L4 | `landing.ts` | `origin` interpolated into HTML/JSON snippets | Escape or hardcode production origin |
| L5 | `index.ts` | `HEAD /` → 404 | Handle HEAD like GET or add `/health` |
| L6 | `package.json` vs `mcp-agent.ts` | Version `1.2.1` vs McpServer `1.2.0` | Sync |
| L7 | `scripts/smoke.mjs` | Success = non-error JSON only | Light per-case shape asserts |
| L8 | `data.ts` `cacheAgeMs()` | Dead / unused | Surface in `get_dataset_stats` or remove |
| L9 | `usage.ts` self-test prefixes | Broad prefix match (`devtools`, `curl-mcp`, …) | Exact match or stricter patterns |

---

## Info / intentional (do not “fix”)

| Item | Why intentional |
|---|---|
| No auth | Public dataset, v1 |
| Depth cap 2 on `get_supply_chain` | Matches site explorer; documented |
| Caps on edge lists / path limits | Context-size / combinatorial safety |
| Non-atomic KV bumps | Documented volume tradeoff |
| Taxonomy snapshot vs live companies/deals | Upstream taxonomy isn’t fetchable as JSON |
| `AllowedCompany` field whitelist | Field discipline |
| Country = HQ, not fab | Data model; geo tools warn |
| Null market caps excluded by min/max filters | Documented in `filter_companies` |
| `find_chokepoints` heuristic scoring | Documented transparent heuristic |
| Consolidation multi-segment deal double-count | Methodology warns not to sum segments |
| Self-test client segregation | Smoke must not dominate metrics |
| Attribution/`links` on every response | Product requirement |
| Dangling supplier/customer ids dropped in `buildGraph` | Matches site algorithm |
| `reaction` omitted from deal payloads | Effectively empty; called out in dataset stats |
| Permissive CORS | `McpAgent.serve()` default; intentional public MCP |

---

## Suggested fix PR order for Claude

1. H1 filter join + H3 disruption ticker (small, high impact).
2. H2 path search → BFS.
3. M1+M2 cache resilience.
4. M4 shared country normalize; M3 drop hardcoded 565.
5. M10 `void recordUsage`; then remaining Medium/Low as capacity allows.

After any tool behavior change: run `node scripts/smoke.mjs https://mcp.wafergraph.com` (and locally if you have a wrangler preview). Smoke fails if a registered tool has no case — keep it that way.
