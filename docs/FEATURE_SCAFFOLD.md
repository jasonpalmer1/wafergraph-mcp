# Feature scaffolding for Claude (wafergraph-mcp + siblings)

Status: **FRAMEWORK ONLY** — stubs and design notes so Claude can implement without
re-deriving intent. Cloud agent laid this down 2026-08-08+. Nothing here is live
until you implement + deploy from the laptop (see `CLAUDE_LOCAL_PICKUP.md`).

---

## A. wafergraph-mcp — proposed next features

### A1. ✅ DONE — Shared context + core tool extraction

**Shipped on this branch:**
- `src/tools/ctxload.ts` — `loadGraph()` / `loadAll()`
- `resolveCompany` + `Graph.byTicker`, identity-cached `buildGraph`
- `normalizeCountryQuery` / `resolvePartyCompany` in `shared.ts`
- Tools 1–9 live in `src/tools/core.ts`; `mcp-agent.ts` is registration-only (~40 lines)
- Graphtools / deals / geo (graph paths) / screen (similar) use `loadGraph`/`loadAll`

**✅ Loader migration:** remaining `screen.ts` / `geo.ts` handlers now use
`loadGraph()` / `loadAll()` (no bare `getCompanies()` in those modules).

### A2. ✅ DONE (off by default) — Light rate limiting

Wired in `src/index.ts` + `src/ratelimit.ts`. Enable with Worker var/secret
`RATE_LIMIT_ENABLED=1`. Keys by `mcp-session-id` or CF colo (never raw IP).
Fail-open. Leave off unless abuse appears.

**Claude to enable on laptop:**
```bash
cd ~/projects/wafergraph-mcp
npx wrangler secret put RATE_LIMIT_ENABLED   # enter: 1
# or vars in dashboard; then npm run deploy
```

### A3. ✅ `resolve_ticker` is the only batch resolver

Tool description now says so explicitly; uses `loadGraph` + `byTicker`.
**Do not add a second `batch_resolve` tool.**

### A4. ✅ DONE — `compact` on get_company / compare / get_supply_chain

- `get_company({ compact })` — brief refs + 25-edge cap
- `compare_companies({ compact })` — brief rows
- `get_supply_chain({ compact })` — 12 companies/tier + 40 edges, with `tier_total`

### A4b. ✅ NEW TOOL — `find_substitutes`

In `screen.ts`. Follow-up to chokepoints / single-source: same-niche taxonomy
overlap ranking. Smoke case included. Not commercial interchangeability.

### A4d. ✅ NEW TOOL — `recommend_tools`

In `src/tools/meta.ts`. Intent → primary tool (+ follow-ups). Extend `ROUTING` when adding tools.

### A4c. ✅ NEW TOOL — `explain_relationship`

In `graphtools.ts`. One call: shortest paths (either direction) + shared
suppliers/customers + direct-edge flags. Prefer over chaining
`find_paths_between` + `compare_companies` for “how are A and B connected?”.

### A4e. ✅ NEW TOOL — `diff_supply_chains`

In `graphtools.ts`. 1-hop supplier/customer set diff (shared / only_a / only_b + Jaccard).
Smoke + `recommend_tools` routing included.

### A5. ✅ DONE — Freshness on every successful tool response

`jsonResult` in `shared.ts` attaches `{ freshness: { live_cache_age_ms } }`
(sibling of `data` / `attribution` / `links`). Smoke asserts the field exists.
`get_dataset_stats` still carries its own detailed freshness block inside `data`.

### A4f. ✅ NEW TOOL — `list_stale_companies`

In `deals.ts`. Oldest `last_verified` rows (optional segment + days-behind-newest filter).
Companion to `get_dataset_stats` staleness summary.

### A6. Taxonomy live-fetch when upstream exposes JSON

Today taxonomy is vendored (`data/taxonomy.snapshot.json`). If wafergraph.com
ever serves real `taxonomy.json`, flip `getTaxonomy()` in `data.ts` to the same
live-fetch path as companies/deals and delete the snapshot ritual. Until then:
keep `scripts/refresh-data.sh`.

### A7. ✅ NEW TOOL — `compare_segments`

In `geo.ts`. 2–4 segments: counts, country HHI, position mix, priced coverage,
leaders, edge density, shared top HQ countries. Smoke + ROUTING included.

### A8. ✅ Org — version sync helper

`src/version.ts` (`PACKAGE_VERSION`, `TOOL_COUNT`), landing uses them,
`npm run check:versions` asserts package.json / server.json / version.ts agree.
Smoke asserts `tools/list.length === TOOL_COUNT`.

### A9. ✅ `get_deals` filters + sort

Optional `status`, `year`, `type` (exact), and `sort_by` (`announced`|`value`) on
`get_deals`. Description corrected: corpus is multi-type, not acquisitions-only.

### A10. ✅ `get_company` edge importance sort

Neighbor lists sorted by market cap before EDGE_CAP slice (was insertion order).

### A11. ✅ Richer freshness block

`jsonResult` attaches `liveFreshness()`:
`{ live_cache_age_ms, companies_age_ms, deals_age_ms, stale }`.

---

## B. worldcup-bracket — after CRITICAL security patches

Only after `docs/ready-fixes/worldcup-bracket.md` is applied and deployed:

1. **Edit-token email/share link** — “copy your private edit link” UX after create.
2. **Admin session cookie** — replace `localStorage` pass.
3. **Official results feed stub** — see
   `docs/ready-fixes/worldcup-bracket-results-provider.md` (after CRITICAL security).

---

## C. jasonwpalmer-com — after CSP/subscribe fixes

1. **Build-log template** — see `docs/ready-fixes/jasonwpalmer-com-build-log-template.md`
   (copy into `~/projects/jasonwpalmer-com`).
2. **tools.ts sync checklist** — when wafergraph-mcp or worldcup changes,
   update the matching card in `src/data/tools.ts` (counts, blurb, status).
3. **Subscribe rate-limit** — see ready-fix; then optional Turnstile.

---

## D. Cross-project “operator” scaffolding

Jason’s stack is multi-repo on one machine. A useful Claude habit (document in
`~/projects/CONVENTIONS.md` if missing):

```
## After shipping any public tool
1. Deploy the tool repo (wrangler / pages)
2. Smoke / open the URL
3. Update jasonwpalmer-com src/data/tools.ts card if it’s showcased
4. One line in that repo’s CLAUDE.md Current focus: what shipped + date
```

---

## E. Explicit non-goals (do not scaffold unless asked)

- Auth on wafergraph-mcp v1
- Importing code from `~/projects/wafergraph` into the MCP (read-only boundary)
- Touching Sous from this audit thread
- Averaging deal `confidence` into derived scores
- Treating HQ country as fab location

---

## F. Implementation order Claude should prefer

1. Local pickup of wafergraph-mcp PR → deploy → smoke  
2. worldcup CRITICAL ready-fix → deploy  
3. jasonwpalmer-com CSP/subscribe → deploy  
4. go-no-go / claude-code-setup ready-fixes (local `~/.claude`)  
5. Then A1/A3 features above if there’s appetite  
