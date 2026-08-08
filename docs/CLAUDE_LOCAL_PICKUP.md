# Claude: local pickup & deploy map

> **Critical:** Jason runs and deploys these projects from **his own machine**, not by
> relying on GitHub Actions / this cloud agent to ship. Cloud agent PRs are a
> **source of patches and notes**. You (Claude Code on the laptop) must apply them
> in the right local checkout and run the local deploy commands.

Source of this note: Cursor cloud agent `bc-019fe37e-1d17-72d7-8421-1228c564bedb` (2026-08-08+).

---

## Assumed local layout

Based on existing project docs (`~/projects/wafergraph`, `~/projects/CONVENTIONS.md`):

```
~/projects/
  CONVENTIONS.md          # stack / deploy / quality gate (read first)
  wafergraph/             # upstream data site (read-only boundary for MCP)
  wafergraph-mcp/         # THIS repo — MCP server → mcp.wafergraph.com
  worldcup-bracket/       # CF Worker + D1 bracket pool
  jasonwpalmer-com/       # Next static → CF Pages (jasonwpalmer.com)
  react-canvas-force-graph/
  claude-code-setup/      # often mirrored into ~/.claude
  go-no-go/               # workflow script → ~/.claude/workflows/
  sous/                   # SEPARATE CHAT — do not duplicate here
```

If a path differs on the machine, check `~/projects/` and each repo’s `CLAUDE.md` /
`CLAUDE.local.md` before inventing locations.

---

## How to pick up cloud-agent work

1. On the laptop, open the target repo under `~/projects/<repo>`.
2. Fetch the PR branch from GitHub **or** copy the relevant files from the PR diff.
   - wafergraph-mcp PR: https://github.com/jasonpalmer1/wafergraph-mcp/pull/1  
     Branch: `cursor/bug-audit-handoff-bedb`
3. For **sibling repos** (worldcup, personal site, etc.): cloud agent **could not push**.
   Apply patches from `wafergraph-mcp/docs/ready-fixes/<repo>.md` into `~/projects/<repo>`.
4. Run the repo’s quality checks + **local deploy** (below).
5. Update that repo’s `CLAUDE.md` “Current focus” / session memory so the next session knows what’s live.

Do **not** assume merging a GitHub PR auto-deploys anything.

---

## Deploy cheat sheet (run on Jason’s machine)

### wafergraph-mcp → https://mcp.wafergraph.com

```bash
cd ~/projects/wafergraph-mcp   # or wherever this repo lives
npm ci
npm run typecheck
npm run deploy                 # wrangler deploy
node scripts/smoke.mjs https://mcp.wafergraph.com
```

- Do **not** run wrangler from `~/projects/wafergraph` (its `.env` CF token shadows OAuth).
- Taxonomy refresh only: `scripts/refresh-data.sh` (needs local wafergraph checkout).

### worldcup-bracket → CF Worker

```bash
cd ~/projects/worldcup-bracket
npm ci
# apply docs/ready-fixes/worldcup-bracket.md FIRST (CRITICAL security)
npm run deploy                 # wrangler deploy
# D1 migrations if schema changed: see CLAUDE.md / package.json scripts
```

### jasonwpalmer-com → CF Pages

```bash
cd ~/projects/jasonwpalmer-com
npm ci
# apply docs/ready-fixes/jasonwpalmer-com.md (CSP + subscribe)
npm run build
npx wrangler pages deploy      # uses wrangler.toml; or /ship --prod with confirm
```

### react-canvas-force-graph

Copy-paste component library — no CF deploy. Apply `docs/ready-fixes/react-canvas-force-graph.md`
in the local clone; consumers copy `ForceGraph.jsx`.

### claude-code-setup → `~/.claude`

Not a website. Apply `docs/ready-fixes/claude-code-setup.md`, then mirror hooks/commands into
`~/.claude` per that repo’s ONBOARDING/README.

### go-no-go → `~/.claude/workflows/go-no-go.js`

Apply `docs/ready-fixes/go-no-go.md`, then reinstall/copy the script to the workflows path.

### Sous

Out of scope for this cloud run. Separate chat owns it.

---

## Reading order when you sit down

1. `~/projects/CONVENTIONS.md` (if present)
2. This file (`docs/CLAUDE_LOCAL_PICKUP.md`)
3. `AUDIT_HANDOFF_FOR_CLAUDE.md` (what’s done / what’s left)
4. Target repo `CLAUDE.md` + `docs/ready-fixes/<repo>.md` if applying a sibling patch
5. `docs/FEATURE_SCAFFOLD.md` if starting new work rather than fixes

---

## What the cloud agent already shipped in wafergraph-mcp

See `AUDIT_HANDOFF_FOR_CLAUDE.md` §2. After you merge/pull locally: **typecheck → deploy → smoke**.
