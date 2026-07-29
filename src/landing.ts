// Human landing page at "/". One screen: what this is, how to install it,
// and a link back to wafergraph.com. `origin` is the live request origin so
// the install snippets always show the real deployed URL.
export function renderLanding(origin: string): string {
  const mcpUrl = `${origin}/mcp`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wafergraph MCP — semiconductor supply-chain data for AI agents</title>
<meta name="description" content="Remote MCP server exposing wafergraph.com's semiconductor & AI supply-chain dataset: 565 companies, 12 segments, 74 M&A deals, and the supplier/customer graph.">
<style>
  :root {
    --bg: #0b0e14;
    --panel: #11151f;
    --border: #232a3a;
    --text: #e6e9f0;
    --text-dim: #9aa4b8;
    --accent: #5eead4;
    --accent-2: #7dd3fc;
    font-synthesis: none;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    line-height: 1.5;
  }
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 48px 24px 64px;
  }
  .eyebrow {
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0 0 8px;
  }
  h1 {
    font-size: 28px;
    line-height: 1.25;
    margin: 0 0 12px;
    letter-spacing: -0.01em;
  }
  p.lede {
    color: var(--text-dim);
    font-size: 16px;
    margin: 0 0 32px;
  }
  h2 {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-dim);
    margin: 36px 0 12px;
  }
  .tools {
    display: grid;
    gap: 8px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }
  .tools li {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 14px;
  }
  .tools code {
    color: var(--accent-2);
    font-weight: 600;
  }
  .tools span {
    color: var(--text-dim);
  }
  pre {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    overflow-x: auto;
    font-size: 13px;
    margin: 0 0 8px;
  }
  code, pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 28px;
  }
  a.btn {
    display: inline-block;
    padding: 10px 18px;
    border-radius: 8px;
    text-decoration: none;
    font-size: 14px;
    font-weight: 600;
  }
  a.btn.primary {
    background: var(--accent);
    color: #06231e;
  }
  a.btn.secondary {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
  }
  footer {
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 13px;
  }
  footer a { color: var(--accent-2); }
  .muted { color: var(--text-dim); font-size: 13px; }
</style>
</head>
<body>
<main>
  <p class="eyebrow">Remote MCP server</p>
  <h1>wafergraph MCP</h1>
  <p class="lede">
    Read-only access to wafergraph.com's semiconductor &amp; AI supply-chain dataset — 565 companies across
    12 segments, the supplier/customer graph, and a 74-deal M&amp;A corpus — as 30 tools any MCP-speaking
    AI agent can call directly.
  </p>

  <h2>Tools</h2>
  <ul class="tools">
    <li><code>search_companies</code> <span>— name/description search with segment &amp; country filters</span></li>
    <li><code>filter_companies</code> <span>— structured screen: segment, country, position, cap band, sortable</span></li>
    <li><code>get_company</code> <span>— full profile + supplier/customer edges for one company</span></li>
    <li><code>resolve_ticker</code> <span>— batch-resolve tickers, names or ids to canonical companies</span></li>
    <li><code>find_similar_companies</code> <span>— nearest structural neighbours to a company</span></li>
    <li><code>get_segments</code> / <code>list_subsegments</code> / <code>get_subsegment</code> <span>— the taxonomy, with live counts</span></li>
    <li><code>rank_by_market_cap</code> <span>— largest companies, always with cap coverage</span></li>
    <li><code>get_supply_chain</code> <span>— walk the supplier/customer graph up to 2 tiers</span></li>
    <li><code>find_paths_between</code> <span>— documented supply paths between any two companies</span></li>
    <li><code>simulate_disruption</code> <span>— blast radius if a company, country or segment goes offline</span></li>
    <li><code>find_single_source_dependencies</code> <span>— buyers with exactly one documented supplier</span></li>
    <li><code>find_common_suppliers</code> <span>— shared upstream across a set of companies</span></li>
    <li><code>find_chokepoints</code> / <code>rank_by_connectivity</code> <span>— who everything routes through</span></li>
    <li><code>get_upstream_concentration</code> <span>— one company's supplier mix, with an HHI index</span></li>
    <li><code>list_countries</code> / <code>get_country_profile</code> / <code>compare_countries</code> <span>— geography</span></li>
    <li><code>get_country_exposure</code> / <code>get_segment_leaders</code> <span>— who runs each layer, and from where</span></li>
    <li><code>compare_companies</code> <span>— 2-6 companies side by side, plus what they share</span></li>
    <li><code>analyze_portfolio_exposure</code> <span>— tickers in, shared upstream dependencies out</span></li>
    <li><code>get_deals</code> / <code>get_deal</code> / <code>find_deals_by_company</code> <span>— the M&amp;A corpus</span></li>
    <li><code>get_ma_activity_summary</code> / <code>find_consolidation_hotspots</code> <span>— where consolidation is happening</span></li>
    <li><code>get_dataset_stats</code> <span>— coverage, freshness, and what this data cannot answer</span></li>
  </ul>

  <h2>Claude Code</h2>
  <pre><code>claude mcp add --transport http wafergraph ${mcpUrl}</code></pre>

  <h2>claude.ai (custom connector)</h2>
  <p class="muted">Settings &rarr; Connectors &rarr; Add custom connector &rarr; paste this URL:</p>
  <pre><code>${mcpUrl}</code></pre>

  <h2>Generic MCP client (Streamable HTTP)</h2>
  <pre><code>{
  "mcpServers": {
    "wafergraph": {
      "url": "${mcpUrl}"
    }
  }
}</code></pre>

  <div class="row">
    <a class="btn primary" href="https://wafergraph.com" target="_blank" rel="noopener">Explore wafergraph.com &rarr;</a>
    <a class="btn secondary" href="https://wafergraph.com/pro" target="_blank" rel="noopener">Vendor Exposure Review &rarr;</a>
  </div>

  <footer>
    No auth, no cost, read-only. Data compiled by <a href="https://wafergraph.com">wafergraph.com</a> from public
    sources (SEC, Wikidata, Wikipedia, GLEIF) — see <code>ATTRIBUTION.md</code> in the repo and the
    <code>attribution</code> field on every tool response for licensing detail.
  </footer>
</main>
</body>
</html>
`;
}
