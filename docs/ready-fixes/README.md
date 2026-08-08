# Ready fix: cross-repo index

Status: NOT YET APPLIED (Claude: apply in that repo)
Source audit: wafergraph-mcp AUDIT_HANDOFF_FOR_CLAUDE.md (2026-08-08)

These files are **complete, Claude-ready fix patches** for Jason Palmer's other repos.
They were written from a read-only clone under `/tmp/repos/` during the wafergraph-mcp
audit run. **Do not expect this agent to push to those repos** — only `wafergraph-mcp`
is writable here. Copy each file into a Claude Code session opened in the target repo
(or paste the relevant sections) and apply there.

## How Claude should use these

1. Open the target repo locally (`~/projects/<repo>` or wherever it lives).
2. Read the matching `docs/ready-fixes/<repo>.md` from this wafergraph-mcp checkout (or paste it).
3. Apply patches in the **order listed inside that file** (security / correctness first).
4. Run the file's "Done when" checklist before committing.
5. Do **not** re-audit from scratch unless a snippet no longer matches current source —
   line numbers were accurate as of the 2026-08-08 clone; search for the quoted
   before-snippets if lines drifted.

Sous is out of scope (separate chat). wafergraph-mcp findings live in
`docs/BUG_AUDIT_wafergraph-mcp.md`, not here.

## Apply order (product risk first)

| Order | File | Repo | Severity | Why first |
|------:|------|------|----------|-----------|
| 1 | [`worldcup-bracket.md`](./worldcup-bracket.md) | `worldcup-bracket` | **CRITICAL** | Unauthenticated PUT IDOR, name-as-identity, stored XSS → admin pass steal, no pick validation, CORS `*` |
| 2 | [`jasonwpalmer-com.md`](./jasonwpalmer-com.md) | `jasonwpalmer-com` | High | Live analytics dead (CSP); subscribe email abuse / Resend cost |
| 3 | [`go-no-go.md`](./go-no-go.md) | `go-no-go` | High | Docs claim every killer is verified; script only verifies top 3; purpose-mode veto vocab wrong |
| 4 | [`claude-code-setup.md`](./claude-code-setup.md) | `claude-code-setup` | High | Ledger path mismatch; SessionEnd `acceptEdits` blast radius; monday-cockpit broad grants |
| 5 | [`react-canvas-force-graph.md`](./react-canvas-force-graph.md) | `react-canvas-force-graph` | Medium | Stale `onNodePick`; visual props ignored; resize doesn't rescale |
| 6 | [`jasonwpalmer-com-build-log-template.md`](./jasonwpalmer-com-build-log-template.md) | `jasonwpalmer-com` | Scaffold | MDX build-log template for shipping posts |
| 7 | [`worldcup-bracket-results-provider.md`](./worldcup-bracket-results-provider.md) | `worldcup-bracket` | Scaffold | After CRITICAL fixes — resultsProvider interface |
| 8 | [`jasonwpalmer-com-tools-card.md`](./jasonwpalmer-com-tools-card.md) | `jasonwpalmer-com` | Post-deploy | Sync showcase card to wafergraph-mcp **36 tools / 1.3.5** |

## Status legend

Every file starts with `Status: NOT YET APPLIED`. After Claude applies a fix in the
target repo, update that file's status line (or delete it from this folder once the
target repo's own PR lands — your call).

## Source

- Audit index: `/workspace/AUDIT_HANDOFF_FOR_CLAUDE.md`
- Clone snapshot (audit time): `/tmp/repos/<repo>`
- Agent: Cursor cloud run `bc-019fe37e-1d17-72d7-8421-1228c564bedb`
