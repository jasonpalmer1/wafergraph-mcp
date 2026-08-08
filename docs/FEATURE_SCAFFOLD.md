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

**Claude optional polish:** migrate remaining `getCompanies()`-only handlers in
`screen.ts` / `geo.ts` list tools to `loadGraph()` for consistency (no behavior change).

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

### A3. `resolve_ticker` is already the batch resolver

`resolve_ticker` in `screen.ts` already accepts up to 25 mixed ticker/name/id queries.
**Do not add a second `batch_resolve` tool.** If agents miss it, improve the tool description
and mention it in the landing page tool list — don’t fork.

### A4. ✅ PARTIAL — `get_company({ compact: true })`

Shipped on `get_company`: tighter edge cap (25) + brief company payload.
**Claude next:** add the same flag to `compare_companies` / `get_supply_chain` if agents still blow context.

### A4b. ✅ NEW TOOL — `find_substitutes`

In `screen.ts`. Follow-up to chokepoints / single-source: same-niche taxonomy
overlap ranking. Smoke case included. Not commercial interchangeability.

### A4c. ✅ NEW TOOL — `explain_relationship`

In `graphtools.ts`. One call: shortest paths (either direction) + shared
suppliers/customers + direct-edge flags. Prefer over chaining
`find_paths_between` + `compare_companies` for “how are A and B connected?”.

### A5. Freshness banner on every tool (optional)

`get_dataset_stats` already exposes `live_cache_age_ms`. Optional next step:
attach `{ freshness: { cache_age_ms } }` via a tiny wrapper around `jsonResult`
for tools that touch live data. Keep attribution/links unchanged.

### A6. Taxonomy live-fetch when upstream exposes JSON

Today taxonomy is vendored (`data/taxonomy.snapshot.json`). If wafergraph.com
ever serves real `taxonomy.json`, flip `getTaxonomy()` in `data.ts` to the same
live-fetch path as companies/deals and delete the snapshot ritual. Until then:
keep `scripts/refresh-data.sh`.

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
