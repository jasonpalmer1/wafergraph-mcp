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
//   - direction "both" walks up and down independently so a firm that is
//     both a supplier and a customer of the focal can appear in both tiers
//     (upstream-preferring single map was a known under-count).
import type { Company } from "./types";
import { companyUrl } from "./attribution";

export interface Graph {
  suppliers: Map<string, Set<string>>; // id -> ids that supply it
  customers: Map<string, Set<string>>; // id -> ids that buy from it
  byId: Map<string, Company>;
  byTicker: Map<string, Company>; // UPPERCASE ticker -> company
}

// Identity-keyed cache: getCompanies() returns the same array reference while
// the data cache is fresh, so concurrent tools in one isolate share one graph
// build instead of rebuilding ~615-node edge maps on every call.
let graphCache: { companies: Company[]; graph: Graph } | null = null;

export function buildGraph(companies: Company[]): Graph {
  if (graphCache && graphCache.companies === companies) return graphCache.graph;

  const byId = new Map(companies.map((c) => [c.id, c]));
  const byTicker = new Map<string, Company>();
  for (const c of companies) if (c.ticker) byTicker.set(c.ticker.toUpperCase(), c);
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

  const graph: Graph = { suppliers, customers, byId, byTicker };
  graphCache = { companies, graph };
  return graph;
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

/** id → name → ticker. Use this everywhere a tool accepts "company id/name/ticker". */
export function resolveCompany(g: Graph, raw: string): Company | undefined {
  return findCompany(g, raw) ?? g.byTicker.get(raw.trim().toUpperCase());
}

export type Direction = "up" | "down" | "both";

export interface ChainTierCompany {
  id: string;
  name: string;
  ticker: string | null;
  country: string;
  market_position: Company["market_position"];
  market_cap_usd_b: number | null;
  company_url: string;
}

export interface ChainTier {
  tier: number; // negative = upstream (suppliers), positive = downstream (customers), 0 = focal
  companies: ChainTierCompany[];
}

export interface ChainResult {
  focal_id: string;
  direction: Direction;
  depth: number;
  tiers: ChainTier[];
  edges: Array<{ from: string; to: string }>;
  total_companies: number;
  /** Companies that appear both upstream and downstream of the focal when direction=both. */
  dual_role_company_ids: string[];
  note?: string;
}

function summarize(g: Graph, id: string): ChainTierCompany {
  const c = g.byId.get(id)!;
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

function walkOneDirection(
  g: Graph,
  focalId: string,
  depth: number,
  mode: "up" | "down",
): Map<string, number> {
  const tier = new Map<string, number>();
  let frontier = [focalId];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    const signed = mode === "up" ? -d : d;
    for (const id of frontier) {
      const neighbors = mode === "up" ? suppliersOf(g, id) : customersOf(g, id);
      for (const nid of neighbors) {
        // Never re-admit the focal via a 2-cycle (A↔B would put A in tier ±2).
        if (nid === focalId || tier.has(nid)) continue;
        tier.set(nid, signed);
        next.push(nid);
      }
    }
    frontier = next;
  }
  return tier;
}

export function walkChain(g: Graph, focalId: string, direction: Direction, depthInput: number): ChainResult {
  const depth = Math.min(Math.max(Math.trunc(depthInput), 0), 2);

  const upTier = direction === "up" || direction === "both" ? walkOneDirection(g, focalId, depth, "up") : new Map<string, number>();
  const downTier =
    direction === "down" || direction === "both" ? walkOneDirection(g, focalId, depth, "down") : new Map<string, number>();

  const dual_role_company_ids = [...upTier.keys()].filter((id) => id !== focalId && downTier.has(id));

  const byTier = new Map<number, string[]>();
  byTier.set(0, [focalId]);
  for (const [id, t] of upTier) {
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t)!.push(id);
  }
  for (const [id, t] of downTier) {
    if (!byTier.has(t)) byTier.set(t, []);
    // Dual-role firms appear in both an upstream and a downstream tier.
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

  const included = new Set<string>([focalId, ...upTier.keys(), ...downTier.keys()]);
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
    dual_role_company_ids,
    ...(direction === "both" && dual_role_company_ids.length
      ? {
          note:
            "Some companies appear in both an upstream and a downstream tier (dual_role_company_ids) because they " +
            "have documented edges in both directions relative to the focal. They are listed in both tiers; " +
            "total_companies counts each once.",
        }
      : {}),
  };
}
