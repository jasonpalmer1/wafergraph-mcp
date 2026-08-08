# Audit handoff for Claude

> **Audience:** Claude Code (primary coding agent) and Jason.
> **Author:** Cursor cloud agent run `bc-019fe37e-1d17-72d7-8421-1228c564bedb` ("Mistral AI code review").
> **Date (UTC):** 2026-08-08
> **Agent URL:** https://cursor.com/agents/bc-019fe37e-1d17-72d7-8421-1228c564bedb
> **Branch:** `cursor/bug-audit-handoff-bedb`

---

## 0. Status of prior Mistral work

**Nothing was done before this run.** This cloud agent *is* the run named **"Mistral AI code review"**. It started clean; this handoff + the fixes below are the work product.

**Sous:** not accessible here — leave to the separate chat.

**Write access:** only `wafergraph-mcp`. Sibling repos cannot be pushed from this agent. Ready-to-apply patches for them are in `docs/ready-fixes/`.

---

## 1. What this agent did

| Work | Status |
|---|---|
| Full audit of wafergraph-mcp + 5 public sibling repos | Done |
| Fix High + key Medium bugs in **wafergraph-mcp** | **Done in this PR** (see §2) |
| Ready-to-apply patches for siblings | **Written** → `docs/ready-fixes/` |
| Sous | Out of scope |

`npm run typecheck` passes after the wafergraph-mcp fixes.

---

## 2. wafergraph-mcp — FIXED in this PR

| ID | Issue | Fix |
|---|---|---|
| H1 | `filter_companies` seg+sub independent | Same-membership join when both set (`screen.ts`) |
| H2 | `find_paths_between` DFS missed short paths | BFS by hop length (`graphtools.ts`) |
| H3 | `simulate_disruption` ignored tickers | `resolveCompany` + ticker map |
| M1+M2 | Cache throw on refresh fail / stampede | Stale-on-error + inflight coalesce (`data.ts`) |
| M3 | Hardcoded “565” | Softened to “hundreds” in tool copy / landing / CLAUDE |
| M4 | Country aliases only in geo | `normalizeCountryQuery` / `resolveCountry` in `shared.ts`; used by screen + disruption |
| M5 | `compare_companies` promised unique | Description matches payload (shared only) |
| M6 | Portfolio segment shares >100% | Documented in `interpretation` |
| M7 | `rank_by_market_cap` returned null caps | Rank priced only + coverage note |
| M8 | Silent input truncation | Truncation note on `find_common_suppliers` |
| M10 | `await recordUsage` | `void recordUsage` everywhere |
| L5 | `HEAD /` → 404 | HEAD handled like GET |
| L6 | Version drift | McpServer version → `1.2.1` |

### Still open (lower priority / intentional tradeoffs)

- M9 `walkChain(..., "both")` upstream-wins on bidirectional edges — document or dual-walk later
- M11 `get_deals` segment filter vs null-id party name-match
- M12 public expensive graph tools (v1 intentional; add rate limits if abused)
- L1–L4, L7–L9 — see `docs/BUG_AUDIT_wafergraph-mcp.md`
- Intentional non-bugs (no auth, depth cap 2, field whitelist, country=HQ) — **do not “fix”**

After merge: deploy with `npm run deploy`, then `node scripts/smoke.mjs https://mcp.wafergraph.com`.

---

## 3. Sibling repos — Claude must apply

Open each file in `docs/ready-fixes/` in a Claude session **in that repo** and apply in this order:

1. **`worldcup-bracket.md`** — CRITICAL (IDOR PUT, XSS → admin, pick validation, CORS)
2. **`jasonwpalmer-com.md`** — High (CSP visit-log, subscribe rate limit, Resend `ok`)
3. **`go-no-go.md`** — High (verify all killers / drop unverified; purpose veto; null verdicts)
4. **`claude-code-setup.md`** — High (ledger path; SessionEnd blast radius; monday grants)
5. **`react-canvas-force-graph.md`** — Medium (stale callback; visual props; resize)

Index: [`docs/ready-fixes/README.md`](docs/ready-fixes/README.md).

---

## 4. File map

| File | Purpose |
|---|---|
| `AUDIT_HANDOFF_FOR_CLAUDE.md` | This index — **start here** |
| `docs/BUG_AUDIT_wafergraph-mcp.md` | Original full wafergraph findings |
| `docs/ready-fixes/*` | Concrete patches for sibling repos |
| `CLAUDE.md` | Short pointer under “Audit handoff” |
