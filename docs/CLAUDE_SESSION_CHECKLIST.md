# Claude session checklist (when Jason opens the laptop)

Copy this into your first reply when picking up cloud-agent work. Deploy is **always local**.

## 0. Orient (60 seconds)

- [ ] Read `docs/CLAUDE_LOCAL_PICKUP.md` (paths + deploy)
- [ ] Read `AUDIT_HANDOFF_FOR_CLAUDE.md` (what cloud already did)
- [ ] Confirm local roots under `~/projects/` (or ask Jason once if missing)

## 1. Ship wafergraph-mcp (this PR)

```bash
cd ~/projects/wafergraph-mcp   # adjust if different
git fetch origin
git checkout cursor/bug-audit-handoff-bedb   # or merge into main after review
npm ci
npm run typecheck
npm run deploy
node scripts/smoke.mjs https://mcp.wafergraph.com
```

- [ ] Typecheck green
- [ ] Deploy succeeded
- [ ] Smoke: all tools pass (shape asserts included)

## 2. Sibling security / correctness (priority order)

| # | Repo | Patch file | Deploy |
|---|---|---|---|
| 1 | worldcup-bracket | `docs/ready-fixes/worldcup-bracket.md` | `npm run deploy` in that repo |
| 2 | jasonwpalmer-com | `docs/ready-fixes/jasonwpalmer-com.md` | `npm run build` + `npx wrangler pages deploy` |
| 3 | go-no-go | `docs/ready-fixes/go-no-go.md` | copy into `~/.claude/workflows/` |
| 4 | claude-code-setup | `docs/ready-fixes/claude-code-setup.md` | mirror into `~/.claude` |
| 5 | react-canvas-force-graph | `docs/ready-fixes/react-canvas-force-graph.md` | no CF deploy |

- [ ] Each applied patch: update that repo’s `CLAUDE.md` Current focus with date + one line

## 3. Optional next build (only if Jason wants new work)

- [ ] Skim `docs/FEATURE_SCAFFOLD.md`
- [ ] Prefer finishing ready-fixes before new features
- [ ] Stubs already in tree: `src/ratelimit.ts` (unwired), `src/tools/ctxload.ts` (in use), tools 1–9 in `src/tools/core.ts`

## 4. After any public ship

- [ ] Update `jasonwpalmer-com` `src/data/tools.ts` card if showcased
- [ ] One line in the shipped repo’s `CLAUDE.md` Current focus

## Do not

- Assume GitHub merge = production deploy
- Re-audit from scratch when a ready-fix still matches source
- Touch Sous (separate chat)
- Import code from `~/projects/wafergraph` into wafergraph-mcp
