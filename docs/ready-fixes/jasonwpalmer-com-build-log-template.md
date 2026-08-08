# Ready scaffold: jasonwpalmer-com build-log template

Status: NOT YET APPLIED (Claude: create in `~/projects/jasonwpalmer-com`)
Source: wafergraph-mcp cloud agent feature scaffolding (2026-08-08+)

## Why

Only one blog post exists. When tools ship (wafergraph-mcp 1.3.x, worldcup fixes),
Jason needs a zero-friction MDX starter so Claude can draft a build-log without inventing front-matter.

## Create this file

Path: `src/content/posts/_template.mdx` (leading underscore = not published by posts loader — verify `src/lib/posts.ts` skips `_` prefixes; if it doesn't, name it `TEMPLATE.mdx` and exclude in the loader).

```mdx
---
title: "Build log: <short name>"
date: "YYYY-MM-DD"
summary: "One sentence — what shipped and why it matters."
tags: ["build", "<project>"]
---

## What shipped

-

## Why

-

## How it works

-

## What's next

-
```

## Loader guard (if missing)

In `src/lib/posts.ts`, when reading `src/content/posts/*.mdx`, skip files whose basename starts with `_` or equals `TEMPLATE.mdx`.

## After applying

Add to that repo's `CLAUDE.md` Current focus:

> Build-log template at `src/content/posts/_template.mdx`. Copy → rename → fill when a tool ships; update `src/data/tools.ts` card in the same PR.
