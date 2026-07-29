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

const BASE = (process.argv[2] || "https://wafergraph-mcp.jwpalm99.workers.dev").replace(/\/$/, "");
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

  get_deal: { id: "amd_xilinx" },
  find_deals_by_company: { company: "amd" },
  get_ma_activity_summary: {},
  find_consolidation_hotspots: {},
  get_dataset_stats: {},
};

function preview(result) {
  const text = result?.content?.[0]?.text ?? "";
  try {
    const payload = JSON.parse(text);
    if (payload.error) return { ok: false, note: `tool returned error: ${payload.error}` };
    const keys = Object.keys(payload.data ?? {});
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
      const { ok, note } = preview(result);
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
