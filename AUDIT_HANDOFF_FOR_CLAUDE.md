# Audit handoff for Claude

> **Audience:** Claude Code on Jason’s **laptop** (primary coding + deploy agent).
> **Author:** Cursor cloud agent `bc-019fe37e-1d17-72d7-8421-1228c564bedb` ("Mistral AI code review").
> **Branch:** `cursor/bug-audit-handoff-bedb`
> **PR:** https://github.com/jasonpalmer1/wafergraph-mcp/pull/1

---

## 0. Read this first (deploy reality)

**Sites and Workers are deployed from Jason’s machine, not from this cloud agent / not via GitHub Actions.**

1. Pull or cherry-pick this PR into `~/projects/wafergraph-mcp` (or local path).
2. Apply sibling patches from `docs/ready-fixes/` into each `~/projects/<repo>`.
3. Deploy with that repo’s wrangler/pages commands.

**First file when you sit down:** `docs/CLAUDE_SESSION_CHECKLIST.md`  
Then: `docs/CLAUDE_LOCAL_PICKUP.md` · `docs/FEATURE_SCAFFOLD.md` · `docs/ready-fixes/`

Sous = separate chat. Do not duplicate.

---

## 1. What the cloud agent completed

| Work | Status |
|---|---|
| Cross-repo bug audit | Done |
| wafergraph-mcp High/Medium/Low fixes + efficiency | **Done on this branch** |
| Ready-fixes for siblings (no push access) | `docs/ready-fixes/*` |
| Org: tools 1–9 → `src/tools/core.ts`; mcp-agent registration-only | Done |
| `loadGraph`/`loadAll` adoption + graph cache | Done (most tools) |
| Rate-limit scaffold (unwired) | `src/ratelimit.ts` |
| Claude laptop runbook | `docs/CLAUDE_SESSION_CHECKLIST.md` + LOCAL_PICKUP + FEATURE_SCAFFOLD |

`npm run typecheck` should pass after pull. Current package/MCP version: **1.3.7** (37 tools).

### Latest loop (continuous cloud work)

- Feature: **recommend_tools** meta router (`src/tools/meta.ts`)

- Feature: compare_companies({ compact: true })
- Scaffold: worldcup-bracket-results-provider.md (after CRITICAL security)


- Bugfix: `walkChain` no longer re-admits focal via 2-cycles; stale-cache failure backoff (5m)
- Bugfix: `get_deal` schema example `amd_xilinx`; smoke asserts `get_supply_chain` focal exclusion
- Feature: **`find_substitutes`** + **`explain_relationship`** (+ smoke)
- Feature: `get_company({ compact: true })`; optional `RATE_LIMIT_ENABLED=1`; `GET /health`
- Scaffold for laptop: `docs/ready-fixes/jasonwpalmer-com-build-log-template.md`

---

## 2. wafergraph-mcp — fixed this branch (cumulative)

### Correctness
- H1 filter seg+sub same membership
- H2 path search BFS (+ O(1) queue cursor)
- H3 / L2 tickers everywhere via `resolveCompany` on `Graph.byTicker`
- M4 country aliases shared (`normalizeCountryQuery`) including search / single-source / connectivity
- M9 `walkChain("both")` independent up/down walks + `dual_role_company_ids`
- M11 `get_deals` uses `resolvePartyCompany` (null-id name fallback)
- L1 single `companyRef` from shared (includes country)
- L3 defensive `?? ""` / `?? []` on hot paths
- L4 landing origin HTML-escaped
- L7 smoke light shape asserts
- L8 `cacheAgeMs` surfaced on `get_dataset_stats`
- L9 self-test client names = exact set (not prefix)
- M1/M2 cache stale-on-error + inflight
- M3 softened “565” copy
- M5–M8 compare description, portfolio note, priced rank, truncation note
- M10 `void recordUsage`
- HEAD `/`; McpServer version synced with package (1.3.7) via `src/version.ts` + `npm run check:versions`
- `find_common_customers`; `find_paths_between` either-mode collects 2× per side before merge
- `get_company` edge sort; richer freshness; `get_deals` type/sort_by
- `compare_segments`; `diff_supply_chains`; `list_stale_companies`; supply-chain compact
- README synced to current tool count

### Efficiency / org
- `buildGraph` identity-cached against companies array
- `Graph.byTicker` built once per graph
- Graphtools use `loadGraph()` from `src/tools/ctxload.ts`
- Duplicate helpers removed from `mcp-agent.ts`

### Still open / optional
- Move tools 1–9 into `src/tools/core.ts` (FEATURE_SCAFFOLD §A1)
- Wire `src/ratelimit.ts` behind env flag if abused (§A2)
- `batch_resolve` already exists as `resolve_ticker` — don’t duplicate; see scaffold for compact mode etc.
- M12 public expensive tools — intentional v1

---

## 3. Your next actions on the laptop (priority)

1. **wafergraph-mcp:** merge/pull branch → `npm run typecheck` → `npm run deploy` → `node scripts/smoke.mjs https://mcp.wafergraph.com`
2. **worldcup-bracket:** apply `docs/ready-fixes/worldcup-bracket.md` → deploy (**CRITICAL**)
3. **jasonwpalmer-com:** apply `docs/ready-fixes/jasonwpalmer-com.md` → build → pages deploy
4. **go-no-go / claude-code-setup / force-graph:** apply matching ready-fixes locally
5. Optional features: `docs/FEATURE_SCAFFOLD.md`

---

## 4. File map

| File | Purpose |
|---|---|
| `AUDIT_HANDOFF_FOR_CLAUDE.md` | This index |
| `docs/CLAUDE_SESSION_CHECKLIST.md` | **Checkbox runbook — open first on laptop** |
| `docs/CLAUDE_LOCAL_PICKUP.md` | Local paths + deploy commands |
| `docs/FEATURE_SCAFFOLD.md` | Next features + stub guidance |
| `src/tools/core.ts` | Tools 1–9 (was inline in mcp-agent) |
| `docs/BUG_AUDIT_wafergraph-mcp.md` | Original finding detail |
| `docs/ready-fixes/*` | Sibling-repo patches (apply on laptop) |
| `src/ratelimit.ts` | Optional RL scaffold (unwired) |
| `src/tools/ctxload.ts` | Shared loadGraph helper |
