# Feature scaffolding for Claude (wafergraph-mcp + siblings)

Status: **FRAMEWORK ONLY** — stubs and design notes so Claude can implement without
re-deriving intent. Cloud agent laid this down 2026-08-08+. Nothing here is live
until you implement + deploy from the laptop (see `CLAUDE_LOCAL_PICKUP.md`).

---

## A. wafergraph-mcp — proposed next features

### A1. Shared request context helper (org win — do first)

**Goal:** One path for “load companies + graph + resolve company” so tools stop
re-deriving ticker maps / country aliases.

**Already partly done this PR:** `resolveCompany` + `byTicker` on `Graph`,
`buildGraph` identity cache, `normalizeCountryQuery` in `shared.ts`.

**Claude next:**
- Optionally add `src/tools/ctxload.ts`:
  ```ts
  export async function loadGraph() {
    const companies = await getCompanies();
    return { companies, graph: buildGraph(companies) };
  }
  ```
- Migrate tool bodies to use it (pure refactor, no behavior change).
- Long-term: move first 9 tools from `mcp-agent.ts` → `src/tools/core.ts` so
  `mcp-agent.ts` is only the Durable Object + `init()` registration.

### A2. Light rate limiting (public DoS guard)

**Why:** Graph tools are CPU-heavy; v1 is unauthenticated on purpose.

**Scaffold (implement when abuse appears or before a launch push):**

```
src/ratelimit.ts
  - checkRateLimit(env, key): Promise<{ ok: boolean; remaining: number }>
  - Keys: `rl:YYYY-MM-DD-HH:<ip-hash-or-session>` in USAGE_KV
  - Never store raw IPs — hash with a Worker secret salt if you ever key by IP
  - Fail-open (if KV errors, allow the call)
```

Wire in `src/index.ts` around `/mcp` only; return JSON-RPC-friendly 429 text.
Document in CLAUDE.md as optional and off-by-default via env flag
`RATE_LIMIT_ENABLED=1`.

**Do not** add auth in the same PR unless Jason asks — public dataset is intentional.

### A3. `resolve_ticker` is already the batch resolver

`resolve_ticker` in `screen.ts` already accepts up to 25 mixed ticker/name/id queries.
**Do not add a second `batch_resolve` tool.** If agents miss it, improve the tool description
and mention it in the landing page tool list — don’t fork.

### A4. Response `fields` / compact mode (context-size)

**Why:** Hub `get_company` edges are large even with EDGE_CAP.

**Shape:** optional `compact: boolean` on heavy tools — omit `one_liner`/`sources`,
return `briefRef` only. Default false for backward compatibility.

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
3. **Official results feed stub** — `src/resultsProvider.js` interface
   `{ fetchResults(): Promise<Record<string,string>> }` with a manual admin
   implementation first; later a FIFA/scraped provider. Keep scoring pure.

---

## C. jasonwpalmer-com — after CSP/subscribe fixes

1. **Build-log template** — `src/content/posts/_template.mdx` + note in CLAUDE.md
   “Current focus” to add a post when a tool ships.
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
