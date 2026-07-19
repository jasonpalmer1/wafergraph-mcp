# Attribution & Licensing

This server is a read-only MCP wrapper around data compiled by **[wafergraph.com](https://wafergraph.com)**.
wafergraph's own stance (mirrored here): *"independent and free to use with attribution to
wafergraph.com. Underlying facts are sourced from SEC EDGAR, Wikidata, GLEIF, and Wikipedia
(see each source's own terms). Qualitative supply-chain links and market-share figures are
curated estimates, labeled as such. Provided 'as is', no warranty; not financial advice."*

## Sources and their terms

| Source | URL | What it contributes | License / terms |
|---|---|---|---|
| SEC EDGAR | https://www.sec.gov/edgar | Financials, share counts, filings-derived facts | U.S. government work — public domain |
| Wikidata | https://www.wikidata.org/ | Company facts (founding year, employees, HQ, website) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) — no attribution legally required, credited anyway as good practice |
| Wikipedia | https://www.wikipedia.org/ | Plain-language company descriptions | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) — **attribution required**, and any verbatim/derived text redistributed at scale should carry the same share-alike terms |
| GLEIF | https://www.gleif.org/ | Legal entity identifiers (LEI), registered HQ/jurisdiction | GLEIF data is open/free to use; see [GLEIF's data policy](https://www.gleif.org/en/about-lei/gleif-s-data-quality-management/level-1-data-legal-entity-reference-data) |

Curated fields specific to wafergraph itself (`market_position`, segment placement,
supplier/customer edges, `one_liner` summaries) are Jason Palmer's/wafergraph's own editorial
judgment applied to the above sources — not a redistribution of any single source's licensed
text.

## What this server adds

- Every tool response carries an `attribution` block (compiled_by, sources, note, and — for
  single-company responses — a `company_url` deep link to the full sourced profile on
  wafergraph.com) and a `links` block pointing back to wafergraph.com and its paid report.
- `key_products` was withheld until 2026-07-19 pending a verified upstream deep-fill (a trust
  decision, not a licensing one — see README "Field discipline"); it is now included.
- The vendored `data/taxonomy.snapshot.json` is a direct copy of wafergraph's own
  `data/taxonomy.json` (same sourcing/terms as above); see CLAUDE.md for why it's vendored
  instead of live-fetched.

## Redistributing data from this server

If you cache, redistribute, or build on top of tool outputs from this server:

1. Keep the `compiled_by`/`sources`/`company_url` attribution attached, or otherwise credit
   wafergraph.com per the license stance above.
2. Any Wikipedia-derived text (typically flowing through a company's sourced profile on
   wafergraph.com, not this server's `one_liner` field directly) must satisfy CC BY-SA 4.0 —
   attribution plus share-alike if you redistribute it as-is or adapted.
3. This is not financial advice and carries no warranty, matching wafergraph.com's own stance.
