# Audit handoff for Claude

> **Audience:** Claude Code (primary coding agent) and Jason.
> **Author:** Cursor cloud agent run `bc-019fe37e-1d17-72d7-8421-1228c564bedb` ("Mistral AI code review").
> **Date (UTC):** 2026-08-08
> **Agent URL:** https://cursor.com/agents/bc-019fe37e-1d17-72d7-8421-1228c564bedb
> **Branch:** `cursor/bug-audit-handoff-bedb`

---

## 0. Status of prior Mistral work

**Nothing was done before this run.**

- This Cursor cloud agent *is* the run named **"Mistral AI code review"** (started from mobile against `jasonpalmer1/wafergraph-mcp`).
- When it started: no branch, no commits, no prior findings files, clean `main`, no other agents (active or archived) visible in this repo/environment.
- Sous was **not** accessible here (no public/private repo visible as `sous` / `Sous` / `sous-app` under `jasonpalmer1` with this token). Jason said a separate chat is already covering Sous — **leave Sous alone**.

This document *is* the documentation of the audit work.

---

## 1. Scope completed

| Repo | Location reviewed | Audited? | Notes |
|---|---|---|---|
| **wafergraph-mcp** | `/workspace` (this repo) | Yes — full source | Primary workspace. Detailed findings in §2 and `docs/BUG_AUDIT_wafergraph-mcp.md`. |
| **worldcup-bracket** | cloned `/tmp/repos/worldcup-bracket` | Yes — full source | Critical auth/XSS issues. See §3. |
| **jasonwpalmer-com** | cloned `/tmp/repos/jasonwpalmer-com` | Yes — full source | CSP breaks analytics; subscribe abuse. See §4. |
| **react-canvas-force-graph** | cloned `/tmp/repos/react-canvas-force-graph` | Yes | Stale callbacks / props. See §5. |
| **claude-code-setup** | cloned `/tmp/repos/claude-code-setup` | Yes | Ledger path mismatch; broad unattended grants. See §6. |
| **go-no-go** | cloned `/tmp/repos/go-no-go` | Yes | Verification coverage contradicts docs. See §7. |
| **jasonpalmer1** (profile README) | not deep-audited | Skipped | Markdown-only profile. |
| **awesome-mcp-servers** forks | not audited | Skipped | Forks, not original product code. |
| **Sous** | not in this environment | **Out of scope** | Separate chat. |

No code fixes were applied in this pass — **findings only**, so you can triage and fix with full context.

---

## 2. wafergraph-mcp — priority summary

Live upstream at audit time: **~615 companies / ~74 deals** (tool copy still says 565).

### Fix first (High)

1. **`filter_companies` segment+subsegment are independent** — `src/tools/screen.ts` ~81–82. Multi-segment companies match `segment=A` + `subsegment=B` even when B is not under A. Fix: require both on the same membership when both filters are set.
2. **`find_paths_between` DFS + result cap can miss shorter paths** — `src/tools/graphtools.ts` `search()`. Claims “shortest first” but DFS + early stop can omit the direct edge. Fix: BFS / iterative deepening by hop length.
3. **`simulate_disruption` docs say ticker; code uses `findCompany` only** — `src/tools/graphtools.ts` ~278. Use `resolveCompany(...)` like the other graph tools.

### Fix soon (Medium) — top picks

4. Stale cache not served on refresh failure — `src/data.ts` `getCompanies`/`getDeals`.
5. No in-flight fetch coalescing (stampede) — same file.
6. Hardcoded “565 companies” stale vs live ~615 — descriptions in `mcp-agent.ts`, `screen.ts`, `geo.ts`, `landing.ts`, `CLAUDE.md`.
7. Country aliases only in geo tools — `USA` works in `get_country_profile`, fails in `filter_companies` / `simulate_disruption`.
8. `compare_companies` description promises unique counterparties; payload only has shared.
9. `analyze_portfolio_exposure` segment shares can sum >100% (multi-segment holdings).
10. `rank_by_market_cap` can fill limit with null-cap companies.
11. `find_common_suppliers` silently truncates displayed `input_companies` at 15.
12. `walkChain(..., "both")` upstream-wins on bidirectional edges — `src/graph.ts`.
13. `await recordUsage(...)` on every tool (should be `void` like session start) — latency coupling to KV.
14. `get_deals` segment filter ignores null-id parties (deal tools elsewhere name-match).

Full table + intentional non-bugs: **`docs/BUG_AUDIT_wafergraph-mcp.md`**.

---

## 3. worldcup-bracket — priority summary

**Most serious repo in this audit.** Friends-and-family pool, but public APIs + XSS make it easy to sabotage.

### Critical / High — fix before any real money/prizes ride on this

1. **Unauthenticated `PUT /api/brackets/:id`** — anyone who lists brackets can overwrite any entry (IDOR). DELETE is admin-gated; PUT is not. `src/index.js` ~113–131.
2. **Name-as-identity takeover** — client binds to first case-insensitive name match, then PUTs. No unique name, no edit token.
3. **Stored XSS via `picks` in inline `onclick`** — `jsq()` escapes `'`/`\` but not `"`; handlers sit in double-quoted attributes. Poisoned picks → steal `localStorage` `wc_pass` → admin APIs.
4. **No server-side pick validation** — any JSON accepted; UI tree rules not enforced; perfect illegal brackets score max **1600**.
5. **CORS `*`** on open mutating APIs — cross-origin vandalism.

### Medium highlights

- Admin pass in `localStorage` as `wc_pass`; no login rate limit.
- Lock check TOCTOU (read locked, then write).
- Unbounded name/picks size; unsafe `JSON.parse` on DB fields → 500.
- PUT `name` non-string crashes; whitespace-only names accepted.
- Docs/CLAUDE scoring & auth model disagree with code (docs say R32=1…F=16+bonus; code is 20/40/80/160/320).
- No leaderboard tie-break for charity prize.

**Suggested fix order:** (1) edit tokens / ownership on PUT → (2) validate picks server-side → (3) kill HTML-string `onclick` → (4) admin session cookie → (5) limits + atomic lock + doc sync.

---

## 4. jasonwpalmer-com — priority summary

Static Next export on Cloudflare Pages + Functions for mailing list.

### High

1. **CSP blocks visit-log script** — `public/_headers` `script-src` allows Beehiiv leftover, not `https://visit-log.jwpalm99.workers.dev`. Live analytics dead. Sister site canaifeel.com already allows that worker.
2. **`/api/subscribe` unthrottled** — no rate limit / CAPTCHA / honeypot; confirmed live 200 path → Resend confirmation email abuse (cost/reputation).

### Medium

3. Resend `fetch` ignores HTTP status — still tells user “check your inbox”.
4. `BootSequence` overlay: click-only skip, no Escape / focus trap / reduced-motion.
5. Stale company counts in blog/build copy vs tools data (~456 vs ~615).
6. Docs still mention Beehiiv / outdated newsletter path.
7. Live `Access-Control-Allow-Origin: *` on site/Functions (not from repo `_headers` — likely dashboard rule).

---

## 5. react-canvas-force-graph — priority summary

Single runtime file `ForceGraph.jsx`.

| Severity | Issue |
|---|---|
| Medium | `onNodePick` omitted from effect deps → stale click handler |
| Medium | Node `color`/`label`/`r` changes ignored after first build (sig is ids+links only) |
| Medium | Resize remasures canvas but does not rescale/rebuild layout |
| Low | `hexA` only handles 6-digit `#rrggbb`; docs overclaim settle-and-stop while default `packets=true` keeps rAF |

---

## 6. claude-code-setup — priority summary

Mostly templates/hooks. Doc bugs matter because Claude follows them literally.

| Severity | Issue |
|---|---|
| High | Token ledger path mismatch: `hooks/token-ledger.py` writes `~/.claude/token_ledger.md`; `/tokens` reads `<MEMORY_DIR>/token_ledger.md` |
| High | SessionEnd auto-`/log` runs `claude -p … --permission-mode acceptEdits` unattended — wide blast radius |
| Medium | Monday cockpit `Bash(git:*)` / `Bash(node:*)` grants are broad (README calls them narrow) |
| Medium | `hook-errors.log` path assumes `~/.claude/hub/` without mkdir |
| Medium | Firewall counter in `/tmp` (symlink/race on shared machines) |
| Medium | Slash commands reference `/code-review`, playbook file, `/verify` not shipped by this repo |

---

## 7. go-no-go — priority summary

| Severity | Issue |
|---|---|
| High | Marketing/PROTOCOL: refute **every** kills/major. Script verifies only top **3**; synth treats unverified as held → wrong NO-GO |
| High | Purpose-mode veto still uses commercial NO-GO/CONDITIONAL-GO vocabulary |
| Medium | Relative / Windows paths treated as inline idea text (`isPath` only `/` or `~`) |
| Medium | Parallel stress keeps failed verifications (`filter(Boolean)` does not drop null verdicts) |
| Medium | PROTOCOL “five stages” / Decide vs implementation (Decide folded into Synthesize; 4 phases in meta) |

---

## 8. What Claude should do next

Suggested order (product risk first):

1. **Sous** — continue in the separate chat (not duplicated here).
2. **worldcup-bracket** — Critical/High security before any pool with real stakes.
3. **wafergraph-mcp** — three High correctness bugs (filter join, path BFS, disruption tickers); then Medium cache/alias/copy items. Detail file: `docs/BUG_AUDIT_wafergraph-mcp.md`.
4. **jasonwpalmer-com** — CSP one-liner + subscribe rate limit.
5. **go-no-go** / **claude-code-setup** — align scripts with claims Claude will trust.
6. **react-canvas-force-graph** — medium UI correctness when you next touch it.

When fixing wafergraph-mcp: keep intentional non-bugs listed in `docs/BUG_AUDIT_wafergraph-mcp.md` (no auth on purpose, depth cap 2, field whitelist, country=HQ, etc.).

---

## 9. Evidence / method notes

- wafergraph-mcp reviewed from live workspace source; key High items spot-checked in file (filter independence at `screen.ts:81-82`; `simulate_disruption` uses `findCompany` at ~278; DFS `search` in `graphtools.ts`).
- Other repos cloned read-only to `/tmp/repos/<name>` at audit time (not pushed anywhere).
- No secrets committed; no deploys performed.
- No PR/issue was opened on the other repos from this agent (write scope is this wafergraph-mcp workspace). Copy findings into those repos’ Claude sessions or issues as needed.

---

## 10. File map of this handoff

| File | Purpose |
|---|---|
| `AUDIT_HANDOFF_FOR_CLAUDE.md` | This cross-repo index + status. **Start here.** |
| `docs/BUG_AUDIT_wafergraph-mcp.md` | Full wafergraph-mcp findings (severity, location, fix, intentional non-bugs). |
| `CLAUDE.md` | Short pointer added under “Audit handoff”. |
