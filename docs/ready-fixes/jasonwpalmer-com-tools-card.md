# Ready fix: update jasonwpalmer-com tools card after wafergraph-mcp ship

Status: NOT YET APPLIED (Claude: apply in `~/projects/jasonwpalmer-com` after MCP deploy)
Source: wafergraph-mcp autonomous loop (2026-08-08+)

**When:** After `npm run deploy` of wafergraph-mcp lands **v1.3.4 / 35 tools** on
https://mcp.wafergraph.com (confirm with `curl -s https://mcp.wafergraph.com/health`
and/or smoke).

---

## Patch — `src/data/tools.ts` (or wherever the wafergraph MCP card lives)

Update the showcased card so counts/blurb match production:

- Tool count: **35** (was 30 / 33 depending on last sync)
- Call out new agent-facing tools if the blurb lists highlights:
  - `recommend_tools`, `explain_relationship`, `diff_supply_chains`
  - `find_substitutes`, `list_stale_companies`
- MCP URL remains `https://mcp.wafergraph.com/mcp`
- Version note optional: `1.3.4`

Then:

```bash
cd ~/projects/jasonwpalmer-com
npm run build
npx wrangler pages deploy …   # your usual Pages deploy
```

One line in that repo’s `CLAUDE.md` Current focus: date + “synced tools card to wafergraph-mcp 1.3.4 / 35 tools”.
