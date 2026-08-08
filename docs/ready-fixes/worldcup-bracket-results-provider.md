# Ready scaffold: worldcup-bracket results provider

Status: NOT YET APPLIED — only after CRITICAL security patches in `worldcup-bracket.md`
Source: wafergraph-mcp cloud agent (2026-08-08+)

## Goal

Keep scoring pure (`calcScore` stays a pure function of picks vs results map).
Swap *how results get into the DB* behind a tiny interface so admin paste today
can become a feed later without rewriting the Worker.

## Create `src/resultsProvider.js`

```js
/**
 * @typedef {{ [slotKey: string]: string }} ResultsMap  // e.g. { R32_0: 'Brazil', ... F_0: 'Spain' }
 */

/** Manual / admin-pasted results — default production path. */
export function manualProvider(resultsJson) {
  return {
    name: 'manual',
    /** @returns {Promise<ResultsMap>} */
    async fetchResults() {
      if (!resultsJson || typeof resultsJson !== 'object') return {};
      return resultsJson;
    },
  };
}

/**
 * Future: pull from an external source. Stub only — do not call in prod until implemented.
 * Claude: implement fetch + map into ResultsMap; validate against TEAMS + bracket tree.
 */
export function externalFeedProvider(/* env */) {
  return {
    name: 'external_feed',
    async fetchResults() {
      throw new Error('externalFeedProvider not implemented — use manualProvider');
    },
  };
}
```

## Wire (minimal)

In `src/index.js` admin `PUT /api/config/results`:

1. Parse body.results as today.
2. `const provider = manualProvider(body.results)`.
3. `const results = await provider.fetchResults()`.
4. Validate keys/values (same validation you add in the CRITICAL security patch).
5. Persist `JSON.stringify(results)`.

Do **not** auto-poll external feeds in v1 — admin trigger only.

## Done when

- [ ] File exists; Worker still deploys
- [ ] Admin save path uses provider interface
- [ ] CLAUDE.md notes “resultsProvider.js — manual now, feed later”
