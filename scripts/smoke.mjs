#!/usr/bin/env node
// Live smoke test: drives every registered tool over real Streamable HTTP
// JSON-RPC against a deployed (or local `wrangler dev`) worker.
//
//   node scripts/smoke.mjs                      # hits production
//   node scripts/smoke.mjs http://localhost:8787
//
// Typechecking proves the code compiles; only this proves a tool answers.
// It calls tools/list first and fails if any registered tool goes uncalled,
// so a tool added without a smoke case cannot ship untested.
//
// clientInfo.name is "smoke" on purpose: src/usage.ts routes that under the
// `selftest:` key prefix so our own probes never inflate real adoption counts.

const BASE = (process.argv[2] || "https://mcp.wafergraph.com").replace(/\/$/, "");
const URL_MCP = `${BASE}/mcp`;

let sessionId = null;
let nextId = 1;

// Streamable HTTP replies either as JSON or as an SSE stream; accept both.
async function rpc(method, params, { notify = false } = {}) {
  const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: nextId++, method, params };
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(URL_MCP, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  if (notify) return null;

  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${method}: ${text.slice(0, 300)}`);

  const line = text.split("\n").find((l) => l.startsWith("data: "));
  const parsed = JSON.parse(line ? line.slice(6) : text);
  if (parsed.error) throw new Error(`${method} -> JSON-RPC error ${parsed.error.code}: ${parsed.error.message}`);
  return parsed.result;
}

// One representative call per tool. Arguments are real ids from the dataset
// so a silent empty result is visible as a failure, not mistaken for "works".
const CASES = {
  search_companies: { query: "wafer" },
  get_company: { id: "tsmc" },
  get_segments: {},
  get_supply_chain: { id: "nvidia", direction: "up", depth: 2 },
  get_deals: {},
  compare_companies: { ids: ["nvidia", "amd"] },
  get_country_exposure: { segment: "foundry" },
  find_chokepoints: { segment: "foundry" },
  analyze_portfolio_exposure: { holdings: ["NVDA", "TSM", "AMD"] },

  filter_companies: { segment: "foundry", sort_by: "market_cap" },
  list_subsegments: { segment: "materials" },
  get_subsegment: { segment: "materials", subsegment: "silicon_wafers" },
  find_similar_companies: { id: "asml" },
  rank_by_market_cap: { segment: "design_fabless", limit: 5 },
  resolve_ticker: { queries: ["NVDA", "asml", "Shin-Etsu Chemical", "not_a_real_company"] },
  find_substitutes: { id: "asml", limit: 5 },

  list_countries: {},
  get_country_profile: { country: "Taiwan" },
  compare_countries: { countries: ["Taiwan", "United States"] },
  get_segment_leaders: { segment: "foundry" },
  get_upstream_concentration: { id: "tsmc" },

  find_paths_between: { from: "shin_etsu", to: "nvidia", max_depth: 3 },
  simulate_disruption: { company_id: "tsmc" },
  find_single_source_dependencies: { segment: "foundry" },
  rank_by_connectivity: { metric: "customers", limit: 10 },
  find_common_suppliers: { company_ids: ["nvidia", "amd", "intel"] },
  explain_relationship: { from: "nvidia", to: "tsmc", max_depth: 3, path_limit: 5 },
  diff_supply_chains: { a: "nvidia", b: "amd", side: "both", limit: 10 },

  get_deal: { id: "amd_xilinx" },
  find_deals_by_company: { company: "amd" },
  get_ma_activity_summary: {},
  find_consolidation_hotspots: {},
  get_dataset_stats: {},
  list_stale_companies: { limit: 5, older_than_days_vs_newest: 30 },
  recommend_tools: { intent: "who could replace ASML as a lithography supplier" },
};

/** Light shape checks — still success-oriented, but empty/wrong payloads fail. */
const ASSERTS = {
  get_company: (d) => d?.company?.id === "tsmc",
  compare_companies: (d) =>
    Array.isArray(d?.companies) &&
    Array.isArray(d?.shared_suppliers?.companies) &&
    typeof d?.shared_suppliers?.total === "number",
  get_supply_chain: (d) =>
    d?.focal_id === "nvidia" &&
    Array.isArray(d?.tiers) &&
    !d.tiers.some((t) => t.tier !== 0 && (t.companies ?? []).some((c) => c.id === "nvidia")),
  resolve_ticker: (d) => Array.isArray(d?.results) && typeof d?.matched_count === "number",
  rank_by_market_cap: (d) => Array.isArray(d?.results) && d.results.every((r) => typeof r.market_cap_usd_b === "number"),
  find_paths_between: (d) => Array.isArray(d?.paths),
  get_deal: (d) => typeof d?.id === "string" && d.id.includes("amd"),
  get_dataset_stats: (d) => typeof d?.counts?.companies === "number" && d.counts.companies > 0,
  list_stale_companies: (d) => Array.isArray(d?.results) && typeof d?.matching_total === "number",
  simulate_disruption: (d) => d?.removed?.criterion === "company",
  find_substitutes: (d) => Array.isArray(d?.results) && d?.focal?.id,
  explain_relationship: (d) =>
    d?.from?.id && d?.to?.id && Array.isArray(d?.paths) && typeof d?.summary === "string",
  diff_supply_chains: (d) =>
    d?.a?.id &&
    d?.b?.id &&
    d?.suppliers?.shared &&
    d?.customers?.shared &&
    typeof d?.suppliers?.jaccard === "number",
  recommend_tools: (d) => Array.isArray(d?.recommendations) && d.recommendations[0]?.primary,
};

function preview(result, toolName) {
  const text = result?.content?.[0]?.text ?? "";
  try {
    const payload = JSON.parse(text);
    if (payload.error) return { ok: false, note: `tool returned error: ${payload.error}` };
    if (!payload.freshness || !("live_cache_age_ms" in payload.freshness)) {
      return { ok: false, note: `missing freshness.live_cache_age_ms on ${toolName}` };
    }
    const data = payload.data ?? {};
    const assert = ASSERTS[toolName];
    if (assert && !assert(data)) {
      return { ok: false, note: `shape assert failed for ${toolName}; keys: ${Object.keys(data).slice(0, 8).join(", ")}` };
    }
    const keys = Object.keys(data);
    return { ok: true, note: `${text.length} bytes, data keys: ${keys.slice(0, 6).join(", ")}` };
  } catch {
    return { ok: false, note: `non-JSON response: ${text.slice(0, 120)}` };
  }
}

const run = async () => {
  console.log(`→ ${URL_MCP}\n`);

  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1.0" },
  });
  await rpc("notifications/initialized", {}, { notify: true });

  const listed = (await rpc("tools/list", {})).tools.map((t) => t.name);
  console.log(`tools/list reports ${listed.length} tools\n`);

  const uncovered = listed.filter((name) => !(name in CASES));
  const stale = Object.keys(CASES).filter((name) => !listed.includes(name));

  let pass = 0;
  const failures = [];

  for (const name of listed) {
    if (!(name in CASES)) continue;
    process.stdout.write(`  ${name.padEnd(32)}`);
    try {
      const result = await rpc("tools/call", { name, arguments: CASES[name] });
      const { ok, note } = preview(result, name);
      if (ok) {
        pass++;
        console.log(`ok    ${note}`);
      } else {
        failures.push(`${name}: ${note}`);
        console.log(`FAIL  ${note}`);
      }
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
      console.log(`FAIL  ${err.message}`);
    }
  }

  console.log(`\n${pass}/${listed.length} tools answered`);
  if (uncovered.length) console.log(`no smoke case defined for: ${uncovered.join(", ")}`);
  if (stale.length) console.log(`smoke case for tool that no longer exists: ${stale.join(", ")}`);
  if (failures.length) {
    console.log(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  }

  const clean = failures.length === 0 && uncovered.length === 0 && stale.length === 0;
  process.exit(clean ? 0 : 1);
};

run().catch((err) => {
  console.error(`\nfatal: ${err.message}`);
  process.exit(1);
});
