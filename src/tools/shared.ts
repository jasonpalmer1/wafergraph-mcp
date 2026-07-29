// Shared helpers for the tool modules in this directory.
//
// Every tool module exports a `register*Tools(server, ctx)` function that the
// agent calls once during init(). The helpers here are the same ones the
// original nine tools in mcp-agent.ts use, lifted so the modules can share
// them without importing from the agent (which would be circular).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { companyUrl } from "../attribution";
import type { Company } from "../types";
import type { Graph } from "../graph";

export interface ToolCtx {
  env: Env;
  // Read at call time, not registration time: the flag is set from the
  // initialize handshake, which happens after tools are registered.
  isSelfTest: () => boolean;
}

export type ToolRegistrar = (server: McpServer, ctx: ToolCtx) => void;

export function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

export function errorResult(message: string, extra?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message, ...extra }) }],
    isError: true,
  };
}

// Compact reference to a company for edge/result lists — enough for an agent
// to act on without a second call, small enough to return hundreds of them.
export function companyRef(g: Graph, id: string) {
  const c = g.byId.get(id);
  if (!c) return { id, company_url: companyUrl(id) };
  return {
    id: c.id,
    name: c.name,
    ticker: c.ticker,
    country: c.country,
    market_position: c.market_position,
    market_cap_usd_b: c.market_cap_usd_b,
    company_url: companyUrl(c.id),
  };
}

export function briefRef(c: Company) {
  return {
    id: c.id,
    name: c.name,
    ticker: c.ticker,
    country: c.country,
    market_position: c.market_position,
    market_cap_usd_b: c.market_cap_usd_b,
    company_url: companyUrl(c.id),
  };
}

// Market cap is present on ~72% of records. Any tool that sums or ranks by it
// must say so in its own payload rather than let a consumer read a partial sum
// as a total. This returns the coverage numbers to attach.
export function pricedCoverage(companies: Company[]) {
  const priced = companies.filter((c) => typeof c.market_cap_usd_b === "number");
  return {
    priced_companies: priced.length,
    total_companies: companies.length,
    priced_coverage: companies.length ? Number((priced.length / companies.length).toFixed(3)) : 0,
    market_cap_usd_b_priced_only: Number(priced.reduce((sum, c) => sum + (c.market_cap_usd_b ?? 0), 0).toFixed(2)),
  };
}

// Herfindahl-Hirschman index over a count distribution, 0-1 (1 = fully
// concentrated in one bucket). Returned alongside the raw counts, never
// instead of them.
export function hhi(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  return Number(counts.reduce((sum, n) => sum + Math.pow(n / total, 2), 0).toFixed(4));
}

export function tallyBy<T>(items: T[], key: (item: T) => string | string[]): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const raw = key(item);
    for (const k of Array.isArray(raw) ? raw : [raw]) {
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}
