# Publish pack: wafergraph-mcp

Status: pre-staged only. Nothing has been submitted, posted, or pushed to GitHub. This
repo is still local-only (`git remote -v` is empty). Everything below is written so that
when Jason says "publish mcp," execution is copy/paste, not research.

Built from `CLAUDE.md` and `README.md` in this repo (read 2026-07-19). Facts below are
pulled from those files, nothing invented. Directory mechanics were checked live on the
web the same day; see the "confirmed current" line under each one.

## The facts this pack relies on

- Live: `https://wafergraph-mcp.jwpalm99.workers.dev`, MCP endpoint at `/mcp` (Streamable HTTP), no auth.
- 5 tools: `search_companies`, `get_company`, `get_segments`, `get_supply_chain`, `get_deals`.
- Data: 565 companies, 12 segments, 74 M&A deals, supplier/customer graph. `key_products` field
  is deliberately excluded (unverified upstream data, see this repo's README/CLAUDE.md).
- Attribution: SEC EDGAR (public domain), Wikidata (CC0), Wikipedia (CC BY-SA 4.0, attribution
  required), GLEIF. Every tool response carries an `attribution` block and a `links` block back
  to wafergraph.com and its $99 report.
- Independent project, not an official wafergraph product (stated explicitly in the README).
- GitHub account confirmed authenticated in this environment: `jasonpalmer1` (`gh auth status`).
- Repo has 4 clean commits, working tree clean, no LICENSE file yet (see "Open questions" below).

## Directories checked (all confirmed current 2026-07-19)

Two corrections to flag up front, since they change what execution actually looks like:

1. **`modelcontextprotocol/servers`'s community server list no longer exists.** Its own
   `CONTRIBUTING.md` (pulled directly via `gh api`, not scraped) says plainly that the README
   no longer contains a list of third-party MCP servers: that list was retired in favor of the
   MCP Server Registry, and new server implementations aren't accepted there at all anymore.
   There is no PR to draft here. Publishing to the official registry (below) is the
   replacement, full stop.
2. **PulseMCP's submission page is `pulsemcp.com/submit`, not `/use-cases/submit`.** The latter
   is a different content type ("use case" write-ups) and is explicitly closed to new
   submissions ("Sorry! We are no longer accepting new use case submissions"). The server
   directory submission form is a separate, still-open page.

### A. Official MCP Registry (`registry.modelcontextprotocol.io`)

The canonical registry, maintained under the `modelcontextprotocol` GitHub org. Still labeled
"preview" (breaking changes possible), roughly 2,000 servers listed as of recent reporting.
This is the one that matters most: GitHub's own MCP Registry (below) auto-ingests from it.

- **Manifest required:** `server.json`, drafted and committed at this repo's root (see below).
  Confirmed against the live schema doc (`static.modelcontextprotocol.io/schemas/2025-12-11/...`)
  and the official "remote servers" guide. Remote-only servers use the `remotes` array and do
  **not** need a `packages` entry or an npm publish step at all (that's only for stdio/npm-
  distributed servers). Nothing to publish to npm here.
- **Tool:** `mcp-publisher` CLI, installable via Homebrew (simplest path on Jason's Mac).
- **Auth:** GitHub OAuth device-code flow, matching the already-authenticated `jasonpalmer1`
  account. Namespace is `io.github.jasonpalmer1/wafergraph-mcp`, which matches the
  `jasonpalmer1` account already confirmed authenticated.
- **Precondition:** the GitHub repo must exist and be public first (the `repository.url` in
  `server.json` needs to resolve, and this is also a precondition for every other directory
  below). Do the GitHub repo step before this one.

### B. GitHub MCP Registry (new: this is the "newer major directory")

GitHub's own MCP discovery surface, announced as "your new home base for discovering MCP
servers." **No separate submission exists or is needed.** Per GitHub's own announcement,
developers self-publish servers to the open-source MCP Community Registry, and once published
those servers automatically appear in the GitHub MCP Registry too. Servers are sorted by GitHub
stars and community activity, not a manual review queue. Action: none beyond step A above.

### C. PulseMCP (`pulsemcp.com`)

22,000+ servers, updated daily. Two paths:
- **Automatic:** their own FAQ text says entries from the Official MCP Registry are ingested
  daily and processed weekly, so step A alone should surface it here within about a week, no
  action needed.
- **Manual (faster, recommended for a same-day publish):** `pulsemcp.com/submit`. One URL
  field, which can be a GitHub repository, a subfolder of a repository, or a standalone
  website. Paste the live server URL or the GitHub repo URL.

### D. mcp.so

20,000+ servers listed. Two tiers: a free path (GitHub issue on the `chatmcp/mcpso` repo, which
powers the site) or a paid "Premium" instant/featured listing. Paste-ready free-path issue text
is below, no premium option drafted since that's a spend decision for Jason, not assumed here.

### E. Smithery (`smithery.ai`)

CLI-based. Confirmed command for an already-deployed remote HTTP server (not building on their
platform): `smithery mcp publish <url> -n <org/server>`. No manifest file needed in this repo.
Smithery's own docs state that any server exposing Streamable HTTP is compatible for the
URL-based publish path.

### F. Glama (`glama.ai/mcp/servers`)

57,000+ servers indexed, GitHub-repo-based. Submission is a short web form (repo URL, display
name, description) followed by automated checks (license detection, security scan, health
test). Most listings go live within minutes, no human review gate. An optional `glama.json`
enhances indexing, drafted and committed at this repo's root, matching the minimal real-world
pattern found in `makeplane/plane-mcp-server`'s own `glama.json` (just `$schema` plus
`maintainers`) rather than guessing at undocumented optional fields.

## `server.json` (drafted, committed at repo root)

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.jasonpalmer1/wafergraph-mcp",
  "title": "Wafergraph MCP",
  "description": "Read-only MCP server exposing wafergraph.com's semiconductor and AI supply-chain dataset (565 companies, 12 segments, 74 M&A deals, supplier/customer graph) as 5 tools for AI agents.",
  "version": "1.0.0",
  "repository": {
    "url": "https://github.com/jasonpalmer1/wafergraph-mcp",
    "source": "github"
  },
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://wafergraph-mcp.jwpalm99.workers.dev/mcp"
    }
  ]
}
```

If the registry's schema has moved on by the time this is executed (it's explicitly "preview"
and can change), run `mcp-publisher init` in the repo root first and diff its output against
this file before publishing.

## `glama.json` (drafted, committed at repo root, optional)

```json
{
  "$schema": "https://glama.ai/mcp/schemas/server.json",
  "maintainers": ["jasonpalmer1"]
}
```

## GitHub repo description + topics

**Description** (paste into `gh repo create --description` or repo settings):

```
Read-only remote MCP server for wafergraph.com's semiconductor and AI supply-chain dataset (565 companies, supplier/customer graph, M&A deals). 5 tools, no auth, Cloudflare Workers.
```

**Topics** (as specified):

```
semiconductors supply-chain mcp mcp-server cloudflare-workers
```

Optional extras worth considering, not part of the original spec, easy to add later:
`typescript`, `durable-objects`, `model-context-protocol`.

## Launch blurbs (all paste-ready drafts, posting is always Jason's hand)

### r/mcp (or closest active MCP subreddit, check sidebar self-promo rules before posting,
same caution wafergraph's own LAUNCH_POSTS.md notes for r/semiconductors)

**Title:**
```
Wafergraph MCP: read-only semiconductor supply-chain data (565 companies, deal graph) as 5 tools
```

**Body:**
```
Built a small remote MCP server on top of wafergraph.com's semiconductor and AI supply-chain
dataset. Five read-only tools:

- search_companies: name/description search with segment and country filters
- get_company: full profile for one company plus its supplier/customer edges
- get_segments: the 12-segment taxonomy with live company counts
- get_supply_chain: walk the supplier/customer graph up to 2 tiers, up/down/both
- get_deals: search a 74-deal M&A corpus

No auth, free, Streamable HTTP at /mcp. Every response carries source attribution (SEC EDGAR,
Wikidata, Wikipedia, GLEIF) and a link back to the sourced profile on wafergraph.com.

Repo: https://github.com/jasonpalmer1/wafergraph-mcp
Live: https://wafergraph-mcp.jwpalm99.workers.dev
Install (Claude Code): claude mcp add --transport http wafergraph https://wafergraph-mcp.jwpalm99.workers.dev/mcp

It's brand new, so feedback and bug reports welcome.
```

### X post

```
Shipped a remote MCP server for wafergraph.com's semiconductor supply-chain data: 565
companies, supplier/customer graph, 74 M&A deals, as 5 read-only tools. No auth, free.

https://wafergraph-mcp.jwpalm99.workers.dev
```

### Line for wafergraph's own `docs/LAUNCH_POSTS.md`

**Important:** that file's existing posts (Show HN / r/semiconductors / LinkedIn / X thread
about wafergraph.com itself) are **on hold per Jason's standing instruction** ("the job's not
finished, I'll let you know when it is, stop telling me"). The line below is a separate, later
addendum about this companion MCP server, not a signal to unfreeze those. It has NOT been
written into that file: this repo's task boundary doesn't touch the wafergraph repo, and the
hold means it shouldn't be nudged either. Paste it in only if/when Jason separately says go on
the MCP server specifically.

```
## Addendum: MCP server companion post (short, any platform)

Also shipped: an MCP server on top of the same dataset. wafergraph-mcp exposes 565 companies,
the supplier/customer graph, and the 74-deal M&A corpus as 5 read-only tools any MCP-speaking
AI agent can call directly. No auth, free, Streamable HTTP.

Repo: https://github.com/jasonpalmer1/wafergraph-mcp
Live: https://wafergraph-mcp.jwpalm99.workers.dev
```

## Publish runbook: exact ordered commands

Preconditions already true: working tree clean, 4 commits, `gh` authenticated as
`jasonpalmer1`, `server.json`/`glama.json` drafted and committed, `npm audit` clean (per this
repo's own session memory).

**Step 1: create and push the GitHub repo** (must happen first, everything below points at it):
```bash
cd ~/projects/wafergraph-mcp
gh repo create jasonpalmer1/wafergraph-mcp --public --source=. --remote=origin --push
gh repo edit jasonpalmer1/wafergraph-mcp \
  --description "Read-only remote MCP server for wafergraph.com's semiconductor and AI supply-chain dataset (565 companies, supplier/customer graph, M&A deals). 5 tools, no auth, Cloudflare Workers." \
  --add-topic semiconductors --add-topic supply-chain --add-topic mcp --add-topic mcp-server --add-topic cloudflare-workers
```

**Step 2: Official MCP Registry:**
```bash
cd ~/projects/wafergraph-mcp
brew install mcp-publisher              # one-time
mcp-publisher login github              # interactive: opens a device-code flow in browser
mcp-publisher publish                   # reads server.json already committed at repo root

# verify:
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.jasonpalmer1/wafergraph-mcp"
```

**Step 3: GitHub MCP Registry.** Nothing to run. Auto-populates from Step 2, on GitHub's own
schedule.

**Step 4: Smithery:**
```bash
npm install -g smithery@latest
smithery mcp publish https://wafergraph-mcp.jwpalm99.workers.dev/mcp -n jasonpalmer1/wafergraph-mcp
```

**Step 5: Glama:**
1. Go to `https://glama.ai/mcp/servers` and click "Add MCP Server."
2. Paste repo URL `https://github.com/jasonpalmer1/wafergraph-mcp`, display name "Wafergraph,"
   the description line above.
3. Nothing else. Automated checks run, `glama.json` (already committed) is picked up.

**Step 6: PulseMCP:**
```
Go to https://www.pulsemcp.com/submit, paste https://github.com/jasonpalmer1/wafergraph-mcp
(or the live server URL), submit. (Skippable if willing to wait ~1 week for automatic
ingestion from the Official Registry instead.)
```

**Step 7: mcp.so** (free path, GitHub issue):
```bash
gh issue create --repo chatmcp/mcpso --title "Add server: Wafergraph MCP" --body "$(cat <<'EOF'
Name: Wafergraph MCP
Description: Read-only remote MCP server exposing wafergraph.com's semiconductor and AI
supply-chain dataset (565 companies, 12 segments, 74 M&A deals, supplier/customer graph) as 5
tools for AI agents. No auth.
Repo: https://github.com/jasonpalmer1/wafergraph-mcp
Server URL: https://wafergraph-mcp.jwpalm99.workers.dev/mcp
Category: data / finance / semiconductors
EOF
)"
```
(Alternative: the web form at `https://mcp.so/submit?type=server` does the same thing without
`gh`. A paid "Premium" instant-listing tier also exists there, not included here since that's a
spend decision.)

**Step 8: `modelcontextprotocol/servers`.** Nothing to do. Confirmed dead path (see corrections
above); Step 2 is the actual replacement and already covers it.

**Step 9: launch posts.** Stay drafts until Jason posts them by hand. No step here is
automated.

## Open questions / things only Jason can decide

1. **No LICENSE file exists yet.** `ATTRIBUTION.md` covers the *data's* licensing (SEC/Wikidata/
   Wikipedia/GLEIF) but there's no license on the *code* itself, meaning it's "all rights
   reserved" by default the moment the repo goes public. Glama's automated checks specifically
   include license detection, and anyone trying to fork/reuse the server code (not just call
   the hosted tools) will look for one. MIT would match the "free to use" framing already in
   the README, but picking a license is Jason's call, not made here; no LICENSE file was added.
   `gh repo create` also has a `--license` flag if he wants to pick one at creation time.
   Skippable, doesn't block any of the 6 directories above; it just becomes a visible gap on a
   public code repo.
2. Whether to also spend on mcp.so's paid Premium tier (instant and featured vs. the free
   GitHub-issue review queue).
3. Whether to wait out PulseMCP's automatic ~1-week ingestion or do the manual submit for a
   same-day listing (Step 6 above assumes the latter).
