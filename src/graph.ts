// Supply-chain edge graph + chain walk. Reimplemented cleanly for this
// server (not imported from the wafergraph site repo, per instructions) but
// follows the same algorithm the site's site/src/data.js uses for
// buildChain/suppliersOf/customersOf, so results match what wafergraph.com
// itself shows:
//
//   - A company's key_customers/key_suppliers arrays are merged from BOTH
//     directions into one edge set (a company doesn't have to be listed on
//     both sides for the edge to exist), deduped, and dangling ids (not
//     present in the company list) are dropped silently.
//   - get_supply_chain does a breadth-first walk up (suppliers) and/or down
//     (customers) from a focal company, tier by tier, capped at depth 2.
import type { Company } from "./types";

export interface Graph {
  suppliers: Map<string, Set<string>>; // id -> ids that supply it
  customers: Map<string, Set<string>>; // id -> ids that buy from it
  byId: Map<string, Company>;
}

export function buildGraph(companies: Company[]): Graph {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const suppliers = new Map<string, Set<string>>();
  const customers = new Map<string, Set<string>>();
  const seenEdges = new Set<string>();

  const addEdge = (from: string, to: string) => {
    // from supplies to (from is upstream, to is downstream)
    if (from === to || !byId.has(from) || !byId.has(to)) return;
    const key = `${from}>${to}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    if (!customers.has(from)) customers.set(from, new Set());
    customers.get(from)!.add(to);
    if (!suppliers.has(to)) suppliers.set(to, new Set());
    suppliers.get(to)!.add(from);
  };

  for (const c of companies) {
    for (const customerId of c.key_customers ?? []) addEdge(c.id, customerId);
    for (const supplierId of c.key_suppliers ?? []) addEdge(supplierId, c.id);
  }

  return { suppliers, customers, byId };
}

export const suppliersOf = (g: Graph, id: string): string[] => [...(g.suppliers.get(id) ?? [])];
export const customersOf = (g: Graph, id: string): string[] => [...(g.customers.get(id) ?? [])];

// Case/format-tolerant company lookup: exact id, then case-insensitive id,
// then case-insensitive exact name match. Agents don't always pass the
// canonical snake_case id on the first try.
export function findCompany(g: Graph, idOrName: string): Company | undefined {
  const exact = g.byId.get(idOrName);
  if (exact) return exact;
  const needle = idOrName.trim().toLowerCase();
  for (const c of g.byId.values()) {
    if (c.id.toLowerCase() === needle || c.name.toLowerCase() === needle) return c;
  }
  return undefined;
}

export type Direction = "up" | "down" | "both";

export interface ChainTier {
  tier: number; // negative = upstream (suppliers), positive = downstream (customers), 0 = focal
  companies: Array<{
    id: string;
    name: string;
    ticker: string | null;
    market_position: Company["market_position"];
    market_cap_usd_b: number | null;
  }>;
}

export interface ChainResult {
  focal_id: string;
  direction: Direction;
  depth: number;
  tiers: ChainTier[];
  edges: Array<{ from: string; to: string }>;
  total_companies: number;
}

function summarize(g: Graph, id: string) {
  const c = g.byId.get(id)!;
  return {
    id: c.id,
    name: c.name,
    ticker: c.ticker,
    market_position: c.market_position,
    market_cap_usd_b: c.market_cap_usd_b,
  };
}

export function walkChain(g: Graph, focalId: string, direction: Direction, depthInput: number): ChainResult {
  const depth = Math.min(Math.max(Math.trunc(depthInput), 0), 2);
  const tier = new Map<string, number>();
  tier.set(focalId, 0);

  if (direction === "up" || direction === "both") {
    let frontier = [focalId];
    for (let d = 1; d <= depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const supplierId of suppliersOf(g, id)) {
          if (!tier.has(supplierId)) {
            tier.set(supplierId, -d);
            next.push(supplierId);
          }
        }
      }
      frontier = next;
    }
  }

  if (direction === "down" || direction === "both") {
    let frontier = [focalId];
    for (let d = 1; d <= depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const customerId of customersOf(g, id)) {
          if (!tier.has(customerId)) {
            tier.set(customerId, d);
            next.push(customerId);
          }
        }
      }
      frontier = next;
    }
  }

  const byTier = new Map<number, string[]>();
  for (const [id, t] of tier) {
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t)!.push(id);
  }

  const tiers: ChainTier[] = [...byTier.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, ids]) => ({
      tier: t,
      companies: ids
        .sort((a, b) => (g.byId.get(b)?.market_cap_usd_b ?? 0) - (g.byId.get(a)?.market_cap_usd_b ?? 0))
        .map((id) => summarize(g, id)),
    }));

  const included = new Set(tier.keys());
  const edges: Array<{ from: string; to: string }> = [];
  for (const from of included) {
    for (const to of customersOf(g, from)) {
      if (included.has(to)) edges.push({ from, to });
    }
  }

  return {
    focal_id: focalId,
    direction,
    depth,
    tiers,
    edges,
    total_companies: included.size,
  };
}
