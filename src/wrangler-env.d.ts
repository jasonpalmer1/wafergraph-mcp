// Ambient extension for secrets that never appear in wrangler.jsonc (secrets
// are set via `wrangler secret put`, not written to the config file, so
// `npx wrangler types` can't see them and worker-configuration.d.ts won't
// declare them). Declaration-merges with the generated global `Env`
// interface. Regenerating types (`npm run types`) does not remove this file
// or its fields.
interface Env {
  // wafergraph.com's data-access token for companies.json/deals.json,
  // required after that repo gated the two raw-dataset files (2026-08-31).
  // Set via: wrangler secret put WAFERGRAPH_DATA_TOKEN
  WAFERGRAPH_DATA_TOKEN?: string;
}
