// Five graph-analysis tools layered on top of the existing supplier/customer
// edge graph (src/graph.ts): path finding between two companies, disruption
// simulation, single-source dependency screening, connectivity ranking, and
// shared-supplier overlap. Same read-only, pure-function pattern as the
// original nine tools in mcp-agent.ts — see src/tools/shared.ts for the
// lifted helpers this module reuses (jsonResult/errorResult/companyRef).
// graph.ts is treated as read-only: any graph primitive this module needs
// that isn't already exported from there (path search, disruption blast
// radius, single-source detection) is implemented locally below instead of
// editing graph.ts.
//
// EDGE COVERAGE CAVEAT (applies to every tool here): key_customers is filled
// on ~81% of companies, key_suppliers on ~58%. buildGraph() merges both
// directions into one edge set, so an edge can exist because only the OTHER
// side of the relationship documented it — but plenty of real relationships
// are simply undocumented on both sides. Every tool below reports
// `edge_coverage` in its payload and treats a thin/empty result as
// "not documented", never as "does not exist."
import { z } from "zod";
import { getCompanies } from "../data";
import { buildGraph, findCompany, suppliersOf, customersOf, type Graph } from "../graph";
import type { Company } from "../types";
import { attributionForCompany, attributionGeneric, LINKS } from "../attribution";
import { recordUsage } from "../usage";
import { jsonResult, errorResult, companyRef, type ToolRegistrar } from "./shared";

// ---- shared local helpers ----------------------------------------------

// key_customers coverage ~81%, key_suppliers ~58% (verified live against the
// dataset this module was built against). Every tool whose answer depends on
// edges attaches this so a thin result reads as "undocumented", not
// "doesn't exist."
function edgeCoverage(companies: Company[]) {
  const total = companies.length;
  const withCustomers = companies.filter((c) => c.key_customers.length > 0).length;
  const withSuppliers = companies.filter((c) => c.key_suppliers.length > 0).length;
  return {
    total_companies: total,
    companies_with_documented_customers: withCustomers,
    companies_with_documented_suppliers: withSuppliers,
    customer_field_coverage: total ? Number((withCustomers / total).toFixed(3)) : 0,
    supplier_field_coverage: total ? Number((withSuppliers / total).toFixed(3)) : 0,
    note:
      "key_customers is documented on ~81% of companies and key_suppliers on ~58%. This is a curated map of " +
      "documented relationships, not a complete bill of materials — an undocumented edge is not proof that no " +
      "commercial relationship exists.",
  };
}

// Cheap substring-based "did you mean" suggestions for a failed company
// lookup. No fuzzy-matching dependency — just startsWith/includes scoring.
function suggestCompanies(companies: Company[], query: string, max = 5) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return companies
    .map((c) => {
      const name = c.name.toLowerCase();
      const id = c.id.toLowerCase();
      let score = 0;
      if (name.startsWith(q) || id.startsWith(q)) score = 3;
      else if (name.includes(q) || id.includes(q)) score = 2;
      else if (q.length >= 4 && (name.includes(q.slice(0, 4)) || id.includes(q.slice(0, 4)))) score = 1;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => ({ id: x.c.id, name: x.c.name }));
}

function buildTickerMap(companies: Company[]): Map<string, Company> {
  const m = new Map<string, Company>();
  for (const c of companies) if (c.ticker) m.set(c.ticker.toUpperCase(), c);
  return m;
}

function resolveCompany(graph: Graph, byTicker: Map<string, Company>, raw: string): Company | undefined {
  return findCompany(graph, raw) ?? byTicker.get(raw.trim().toUpperCase());
}

const subsegmentKey = (segment: string, subsegment: string) => `${segment}::${subsegment}`;

export const registerGraphTools: ToolRegistrar = (server, ctx) => {
  // ==== 1. find_paths_between ============================================
  server.registerTool(
    "find_paths_between",
    {
      title: "Find paths between two companies",
      description:
        "Every documented supply path between two companies, following supplier->customer edges (e.g. 'how does " +
        "NVIDIA actually depend on Shin-Etsu'). Searches up to max_depth hops in one or both directions and returns " +
        "each path as an ordered list of companies, shortest first. Capped for combinatorial safety; absence of a " +
        "path means undocumented, not disproven — see edge_coverage.",
      inputSchema: {
        from: z.string().describe("Starting company id, name, or ticker."),
        to: z.string().describe("Target company id, name, or ticker."),
        max_depth: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .default(3)
          .describe("Maximum path length in hops (edges). Default 3, hard-capped at 4 to bound the search."),
        direction: z
          .enum(["upstream", "downstream", "either"])
          .optional()
          .default("either")
          .describe(
            "'downstream': paths where `from` supplies (directly or via intermediaries) to `to`. 'upstream': paths " +
              "where `from` depends on `to` as a supplier. 'either': search both directions and label each path.",
          ),
        limit: z.number().int().min(1).max(50).optional().default(10).describe("Max number of paths to return (1-50, default 10)."),
      },
    },
    async ({ from, to, max_depth, direction, limit }) => {
      await recordUsage(ctx.env, "find_paths_between", ctx.isSelfTest());
      const companies = await getCompanies();
      const graph = buildGraph(companies);
      const byTicker = buildTickerMap(companies);

      const fromCompany = resolveCompany(graph, byTicker, from);
      if (!fromCompany) {
        return errorResult(`No company found for "${from}".`, {
          hint: "Use search_companies to find a valid id, name, or ticker.",
          suggestions: suggestCompanies(companies, from),
        });
      }
      const toCompany = resolveCompany(graph, byTicker, to);
      if (!toCompany) {
        return errorResult(`No company found for "${to}".`, {
          hint: "Use search_companies to find a valid id, name, or ticker.",
          suggestions: suggestCompanies(companies, to),
        });
      }
      const src = fromCompany;
      const dst = toCompany;
      if (src.id === dst.id) {
        return errorResult("`from` and `to` resolved to the same company — need two distinct companies to find a path between.");
      }

      const depth = max_depth ?? 3;
      const cap = limit ?? 10;
      const EXPLORATION_BUDGET = 20000;

      function search(mode: "down" | "up"): { paths: string[][]; capped: boolean } {
        const results: string[][] = [];
        const budget = { explored: 0 };
        const visited = new Set<string>([src.id]);
        const path: string[] = [src.id];

        function dfs(current: string, depthSoFar: number) {
          if (results.length >= cap || budget.explored >= EXPLORATION_BUDGET) return;
          budget.explored++;
          if (depthSoFar >= depth) return;
          const neighbors = mode === "down" ? customersOf(graph, current) : suppliersOf(graph, current);
          for (const next of neighbors) {
            if (results.length >= cap || budget.explored >= EXPLORATION_BUDGET) return;
            if (next === dst.id) {
              results.push([...path, next]);
              continue;
            }
            if (visited.has(next)) continue;
            visited.add(next);
            path.push(next);
            dfs(next, depthSoFar + 1);
            path.pop();
            visited.delete(next);
          }
        }
        dfs(src.id, 0);
        return { paths: results, capped: budget.explored >= EXPLORATION_BUDGET || results.length >= cap };
      }

      const found: Array<{ ids: string[]; edgeDirection: "downstream" | "upstream" }> = [];
      let searchCapped = false;
      if (direction === "downstream" || direction === "either") {
        const r = search("down");
        searchCapped = searchCapped || r.capped;
        for (const p of r.paths) found.push({ ids: p, edgeDirection: "downstream" });
      }
      if (direction === "upstream" || direction === "either") {
        const r = search("up");
        searchCapped = searchCapped || r.capped;
        for (const p of r.paths) found.push({ ids: p, edgeDirection: "upstream" });
      }

      found.sort((a, b) => a.ids.length - b.ids.length);
      const totalFound = found.length;
      const sliced = found.slice(0, cap);

      const paths = sliced.map((p) => {
        const hops = p.ids.length - 1;
        const intermediaries = p.ids.length - 2;
        const relationVerb = p.edgeDirection === "downstream" ? "supplies" : "depends on";
        const summary =
          intermediaries <= 0
            ? `${src.name} ${p.edgeDirection === "downstream" ? "supplies directly to" : "depends directly on"} ${dst.name}.`
            : `${src.name} ${relationVerb} ${dst.name} through ${intermediaries} intermediary compan${intermediaries === 1 ? "y" : "ies"} (${hops} hops).`;
        return {
          length: hops,
          direction: p.edgeDirection,
          summary,
          companies: p.ids.map((id) => companyRef(graph, id)),
        };
      });

      return jsonResult({
        data: {
          from: companyRef(graph, src.id),
          to: companyRef(graph, dst.id),
          direction_searched: direction,
          max_depth: depth,
          paths,
          total: totalFound,
          returned: paths.length,
          search_capped: searchCapped,
          ...(paths.length === 0
            ? {
                message:
                  `No documented path found between ${src.name} and ${dst.name} within ${depth} hop(s) (direction: ${direction}). ` +
                  "Absence of a documented path is not proof of no commercial relationship — wafergraph's edge coverage is partial (see edge_coverage).",
              }
            : {}),
          edge_coverage: edgeCoverage(companies),
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ==== 2. simulate_disruption ============================================
  server.registerTool(
    "simulate_disruption",
    {
      title: "Simulate a supply-chain disruption",
      description:
        "Remove one company, every company in one country, or every company in one segment from the documented " +
        "supply graph and report the blast radius: which companies lose a documented supplier, how many alternative " +
        "suppliers they retain in the same subsegment, and which are left with zero documented alternative (ranked " +
        "first). This is a documented-edge simulation, not a forecast — see the caveat field.",
      inputSchema: {
        company_id: z
          .string()
          .optional()
          .describe("Remove a single company by id, name, or ticker. Exactly one of company_id/country/segment is required."),
        country: z.string().optional().describe("Remove every company headquartered in this country (case-insensitive exact match, e.g. 'Taiwan')."),
        segment: z.string().optional().describe("Remove every company in this taxonomy segment id (see get_segments)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Max number of affected companies to return, zero-alternative ones first (1-100, default 20)."),
      },
    },
    async ({ company_id, country, segment, limit }) => {
      await recordUsage(ctx.env, "simulate_disruption", ctx.isSelfTest());
      const provided = [company_id, country, segment].filter((v) => v !== undefined && v.trim() !== "");
      if (provided.length !== 1) {
        return errorResult("Exactly one of company_id, country, or segment is required.", {
          received: { company_id: company_id ?? null, country: country ?? null, segment: segment ?? null },
        });
      }

      const companies = await getCompanies();
      const graph = buildGraph(companies);
      const byId = graph.byId;

      let removedIds: Set<string>;
      let criterion: "company" | "country" | "segment";
      let criterionValue: string;

      if (company_id) {
        const c = findCompany(graph, company_id);
        if (!c) {
          return errorResult(`No company found for "${company_id}".`, {
            hint: "Use search_companies to find a valid id, name, or ticker.",
            suggestions: suggestCompanies(companies, company_id),
          });
        }
        removedIds = new Set([c.id]);
        criterion = "company";
        criterionValue = c.id;
      } else if (country) {
        const ctry = country.trim().toLowerCase();
        const matches = companies.filter((c) => c.country.toLowerCase() === ctry);
        if (matches.length === 0) {
          return errorResult(`No companies found headquartered in "${country}".`, {
            hint: "Use get_country_exposure to see valid country values.",
          });
        }
        removedIds = new Set(matches.map((c) => c.id));
        criterion = "country";
        criterionValue = country;
      } else {
        const seg = segment!.trim().toLowerCase();
        const matches = companies.filter((c) => c.segments.some((s) => s.segment.toLowerCase() === seg));
        if (matches.length === 0) {
          return errorResult(`No companies found in segment "${segment}".`, {
            hint: "Use get_segments for the list of valid segment ids.",
          });
        }
        removedIds = new Set(matches.map((c) => c.id));
        criterion = "segment";
        criterionValue = segment!;
      }

      // Candidates are everyone who lists at least one removed company as a
      // documented supplier — found via the removed companies' customer
      // edges (customersOf(removed) = who depended on it).
      const candidateIds = new Set<string>();
      for (const rid of removedIds) {
        for (const cust of customersOf(graph, rid)) {
          if (!removedIds.has(cust)) candidateIds.add(cust);
        }
      }

      const ALT_CAP = 8;
      const results = [...candidateIds].map((cid) => {
        const allSuppliers = suppliersOf(graph, cid);
        const lostSupplierIds = allSuppliers.filter((sid) => removedIds.has(sid));
        const remainingSupplierIds = allSuppliers.filter((sid) => !removedIds.has(sid));

        const bySubsegment = new Map<string, Set<string>>(); // key -> lost supplier ids in that subsegment
        for (const sid of lostSupplierIds) {
          const s = byId.get(sid);
          if (!s) continue;
          for (const sg of s.segments) {
            const key = subsegmentKey(sg.segment, sg.subsegment);
            if (!bySubsegment.has(key)) bySubsegment.set(key, new Set());
            bySubsegment.get(key)!.add(sid);
          }
        }

        const subsegmentImpact = [...bySubsegment.entries()].map(([key, lostSet]) => {
          const [seg, sub] = key.split("::");
          const alternatives = remainingSupplierIds.filter((sid) =>
            byId.get(sid)?.segments.some((s) => s.segment === seg && s.subsegment === sub),
          );
          return {
            segment: seg,
            subsegment: sub,
            lost_supplier_count: lostSet.size,
            remaining_alternatives: alternatives.length,
            alternative_suppliers: alternatives.slice(0, ALT_CAP).map((id) => companyRef(graph, id)),
          };
        });

        const zeroAltSubsegments = subsegmentImpact.filter((s) => s.remaining_alternatives === 0);

        return {
          company: companyRef(graph, cid),
          lost_suppliers: lostSupplierIds.map((id) => companyRef(graph, id)),
          remaining_supplier_count: remainingSupplierIds.length,
          subsegment_impact: subsegmentImpact,
          zero_alternative_subsegment_count: zeroAltSubsegments.length,
          has_zero_alternative: zeroAltSubsegments.length > 0,
        };
      });

      results.sort((a, b) => {
        if (a.has_zero_alternative !== b.has_zero_alternative) return a.has_zero_alternative ? -1 : 1;
        if (b.zero_alternative_subsegment_count !== a.zero_alternative_subsegment_count) {
          return b.zero_alternative_subsegment_count - a.zero_alternative_subsegment_count;
        }
        return b.lost_suppliers.length - a.lost_suppliers.length;
      });

      const cap = limit ?? 20;
      const sliced = results.slice(0, cap);
      const REMOVED_CAP = 50;

      return jsonResult({
        data: {
          removed: {
            criterion,
            value: criterionValue,
            company_count: removedIds.size,
            companies: [...removedIds].slice(0, REMOVED_CAP).map((id) => companyRef(graph, id)),
            ...(removedIds.size > REMOVED_CAP
              ? { note: `Removed-company list capped at ${REMOVED_CAP}; company_count carries the true total.` }
              : {}),
          },
          affected_companies_total: results.length,
          zero_alternative_count: results.filter((r) => r.has_zero_alternative).length,
          results: sliced,
          total: results.length,
          returned: sliced.length,
          methodology:
            "For each company that lists a removed company as a documented supplier, its lost suppliers are grouped " +
            "by subsegment, then compared against its OTHER (non-removed) documented suppliers in that same " +
            "subsegment. remaining_alternatives = 0 means no documented alternative in that subsegment. Results are " +
            "ranked zero-alternative companies first, then by how many subsegments have zero alternatives, then by " +
            "lost-supplier count.",
          caveat:
            "This is a documented-edge simulation, not a forecast: real firms hold inventory, qualify second " +
            "sources, and substitute in ways this dataset cannot see. A zero-alternative result means no " +
            "alternative is documented here, not that none exists in the real world.",
          edge_coverage: edgeCoverage(companies),
        },
        attribution: criterion === "company" ? attributionForCompany(criterionValue) : attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ==== 3. find_single_source_dependencies ===============================
  server.registerTool(
    "find_single_source_dependencies",
    {
      title: "Find single-source dependencies",
      description:
        "Screen for (customer, subsegment) pairs where the customer has exactly ONE documented supplier in that " +
        "subsegment — the highest-value documented-concentration risk screen in the dataset. Optionally scoped to " +
        "customers in one segment or country. Ranked by the sole supplier's downstream importance (its total " +
        "documented customer count).",
      inputSchema: {
        segment: z.string().optional().describe("Restrict to customers in this taxonomy segment id (see get_segments). Omit for the whole dataset."),
        country: z.string().optional().describe("Restrict to customers headquartered in this country (case-insensitive exact match)."),
        limit: z.number().int().min(1).max(100).optional().default(25).describe("Max number of single-source pairs to return (1-100, default 25)."),
      },
    },
    async ({ segment, country, limit }) => {
      await recordUsage(ctx.env, "find_single_source_dependencies", ctx.isSelfTest());
      const companies = await getCompanies();
      const graph = buildGraph(companies);
      const byId = graph.byId;

      const seg = segment?.trim().toLowerCase();
      const ctry = country?.trim().toLowerCase();
      let scope = companies;
      if (seg) scope = scope.filter((c) => c.segments.some((s) => s.segment.toLowerCase() === seg));
      if (ctry) scope = scope.filter((c) => c.country.toLowerCase() === ctry);
      if (scope.length === 0) {
        return errorResult("No companies match the given scope.", {
          hint: "Use get_segments / get_country_exposure for valid segment/country values.",
        });
      }

      const rows: Array<{
        customer: ReturnType<typeof companyRef>;
        segment: string;
        subsegment: string;
        sole_supplier: ReturnType<typeof companyRef>;
        sole_supplier_market_position: Company["market_position"];
        sole_supplier_downstream_customer_count: number;
      }> = [];

      for (const customer of scope) {
        const supplierIds = suppliersOf(graph, customer.id);
        const bySubsegment = new Map<string, Set<string>>();
        for (const sid of supplierIds) {
          const s = byId.get(sid);
          if (!s) continue;
          for (const sg of s.segments) {
            const key = subsegmentKey(sg.segment, sg.subsegment);
            if (!bySubsegment.has(key)) bySubsegment.set(key, new Set());
            bySubsegment.get(key)!.add(sid);
          }
        }
        for (const [key, supplierSet] of bySubsegment) {
          if (supplierSet.size !== 1) continue;
          const supplierId = [...supplierSet][0];
          const supplier = byId.get(supplierId)!;
          const [segId, subId] = key.split("::");
          rows.push({
            customer: companyRef(graph, customer.id),
            segment: segId,
            subsegment: subId,
            sole_supplier: companyRef(graph, supplierId),
            sole_supplier_market_position: supplier.market_position,
            sole_supplier_downstream_customer_count: customersOf(graph, supplierId).length,
          });
        }
      }

      rows.sort((a, b) => b.sole_supplier_downstream_customer_count - a.sole_supplier_downstream_customer_count);
      const cap = limit ?? 25;
      const sliced = rows.slice(0, cap);

      return jsonResult({
        data: {
          scope: { segment: segment ?? null, country: country ?? null, companies_in_scope: scope.length },
          results: sliced,
          total: rows.length,
          returned: sliced.length,
          methodology:
            "For each customer in scope, its documented suppliers are grouped by supplier subsegment. A subsegment " +
            "with exactly one distinct documented supplier is a single-source dependency. Ranked by that sole " +
            "supplier's total documented downstream customer count (its importance if it were disrupted).",
          caveat:
            "A supplier's subsegment is used as a proxy for what it supplies to this specific customer, since edges " +
            "are not tagged with the product/subsegment they represent. 'Single source' means single DOCUMENTED " +
            "source — a customer with zero documented suppliers in a subsegment is not counted here at all, and a " +
            "real second source may exist without being documented in this dataset.",
          edge_coverage: edgeCoverage(companies),
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ==== 4. rank_by_connectivity ===========================================
  server.registerTool(
    "rank_by_connectivity",
    {
      title: "Rank companies by connectivity",
      description:
        "Rank companies by documented supply-chain degree: customer count (downstream reach), supplier count " +
        "(upstream dependence), or total. CRITICAL: degree measures how well a relationship is DOCUMENTED in this " +
        "curated dataset, not how critical the company actually is — a well-covered firm can outrank a more " +
        "essential but obscure one. See the caveat field in every response.",
      inputSchema: {
        metric: z
          .enum(["customers", "suppliers", "total"])
          .optional()
          .default("total")
          .describe("'customers' = downstream reach, 'suppliers' = upstream dependence, 'total' = sum of both."),
        segment: z.string().optional().describe("Restrict to companies in this taxonomy segment id (see get_segments)."),
        country: z.string().optional().describe("Restrict to companies headquartered in this country (case-insensitive exact match)."),
        limit: z.number().int().min(1).max(50).optional().default(15).describe("Max number of companies to return (1-50, default 15)."),
      },
    },
    async ({ metric, segment, country, limit }) => {
      await recordUsage(ctx.env, "rank_by_connectivity", ctx.isSelfTest());
      const companies = await getCompanies();
      const graph = buildGraph(companies);

      const seg = segment?.trim().toLowerCase();
      const ctry = country?.trim().toLowerCase();
      let scope = companies;
      if (seg) scope = scope.filter((c) => c.segments.some((s) => s.segment.toLowerCase() === seg));
      if (ctry) scope = scope.filter((c) => c.country.toLowerCase() === ctry);
      if (scope.length === 0) {
        return errorResult("No companies match the given scope.", {
          hint: "Use get_segments / get_country_exposure for valid segment/country values.",
        });
      }

      const chosenMetric = metric ?? "total";
      const metricValue = (r: { customer_count: number; supplier_count: number; total_degree: number }) =>
        chosenMetric === "customers" ? r.customer_count : chosenMetric === "suppliers" ? r.supplier_count : r.total_degree;

      const ranked = scope
        .map((c) => {
          const customerCount = customersOf(graph, c.id).length;
          const supplierCount = suppliersOf(graph, c.id).length;
          return {
            ...companyRef(graph, c.id),
            segments: c.segments,
            customer_count: customerCount,
            supplier_count: supplierCount,
            total_degree: customerCount + supplierCount,
          };
        })
        .sort((a, b) => metricValue(b) - metricValue(a));

      const cap = limit ?? 15;
      const sliced = ranked.slice(0, cap);
      const metricFieldName = chosenMetric === "customers" ? "customer_count" : chosenMetric === "suppliers" ? "supplier_count" : "total_degree";

      return jsonResult({
        data: {
          scope: { segment: segment ?? null, country: country ?? null, companies_in_scope: scope.length },
          metric: chosenMetric,
          results: sliced,
          total: ranked.length,
          returned: sliced.length,
          methodology: `Ranked by ${metricFieldName}, counting only supplier/customer edges documented in wafergraph's dataset.`,
          caveat:
            "Degree measures how well a relationship is DOCUMENTED in this curated dataset, not how critical the " +
            "company actually is. A well-covered firm can outrank an obscure one that is genuinely more essential " +
            "to the supply chain — treat this as a documentation-density ranking, not a criticality score.",
          edge_coverage: edgeCoverage(companies),
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ==== 5. find_common_suppliers ==========================================
  server.registerTool(
    "find_common_suppliers",
    {
      title: "Find common suppliers",
      description:
        "The shared-upstream question over a set of companies: given 2-15 company ids/tickers, or a segment id (uses " +
        "every company in that segment), rank suppliers by how many of the input companies they documentedly serve " +
        "(e.g. 'serves 9 of 12'), with each supplier's market position and country. Also reports how many input " +
        "companies had no documented suppliers at all, since that makes a low overlap number ambiguous.",
      inputSchema: {
        company_ids: z
          .array(z.string())
          .min(2)
          .max(15)
          .optional()
          .describe("2-15 company ids, names, or tickers. Exactly one of company_ids/segment is required."),
        segment: z.string().optional().describe("Use every company in this taxonomy segment id instead of an explicit list (see get_segments)."),
        limit: z.number().int().min(1).max(100).optional().default(20).describe("Max number of ranked suppliers to return (1-100, default 20)."),
      },
    },
    async ({ company_ids, segment, limit }) => {
      await recordUsage(ctx.env, "find_common_suppliers", ctx.isSelfTest());
      const hasIds = company_ids !== undefined && company_ids.length > 0;
      const hasSegment = segment !== undefined && segment.trim() !== "";
      if (hasIds === hasSegment) {
        return errorResult("Exactly one of company_ids or segment is required.", {
          received: { company_ids: company_ids ?? null, segment: segment ?? null },
        });
      }

      const companies = await getCompanies();
      const graph = buildGraph(companies);
      const byTicker = buildTickerMap(companies);

      let inputCompanies: Company[];
      let unresolved: string[] = [];
      let inputMode: "company_ids" | "segment";

      if (hasSegment) {
        const seg = segment!.trim().toLowerCase();
        inputCompanies = companies.filter((c) => c.segments.some((s) => s.segment.toLowerCase() === seg));
        if (inputCompanies.length < 2) {
          return errorResult(`Segment "${segment}" has fewer than 2 companies — need at least 2 to find shared suppliers.`, {
            hint: "Use get_segments for the list of valid segment ids and their company counts.",
          });
        }
        inputMode = "segment";
      } else {
        const resolved: Company[] = [];
        for (const raw of company_ids!) {
          const c = resolveCompany(graph, byTicker, raw);
          if (c && !resolved.some((r) => r.id === c.id)) resolved.push(c);
          else if (!c) unresolved.push(raw);
        }
        if (resolved.length < 2) {
          return errorResult("Need at least 2 resolvable companies to find shared suppliers.", {
            unresolved,
            hint: "Use search_companies to find valid ids, names, or tickers.",
          });
        }
        inputCompanies = resolved;
        inputMode = "company_ids";
      }

      const noSuppliers = inputCompanies.filter((c) => suppliersOf(graph, c.id).length === 0);

      const tally = new Map<string, Set<string>>(); // supplierId -> Set of served input company ids
      for (const c of inputCompanies) {
        for (const sid of suppliersOf(graph, c.id)) {
          if (!tally.has(sid)) tally.set(sid, new Set());
          tally.get(sid)!.add(c.id);
        }
      }

      const results = [...tally.entries()]
        .map(([sid, servedSet]) => ({
          ...companyRef(graph, sid),
          served_count: servedSet.size,
          served_share: `${servedSet.size}/${inputCompanies.length}`,
          served_companies: [...servedSet].map((id) => companyRef(graph, id)),
        }))
        .sort((a, b) => b.served_count - a.served_count);

      const cap = limit ?? 20;
      const sliced = results.slice(0, cap);
      const INPUT_CAP = 15;

      return jsonResult({
        data: {
          input_mode: inputMode,
          input_companies: inputCompanies.slice(0, INPUT_CAP).map((c) => companyRef(graph, c.id)),
          input_company_count: inputCompanies.length,
          ...(unresolved.length ? { unresolved } : {}),
          input_companies_with_no_documented_suppliers: noSuppliers.length,
          input_companies_with_no_documented_suppliers_list: noSuppliers.map((c) => companyRef(graph, c.id)),
          results: sliced,
          total: results.length,
          returned: sliced.length,
          methodology:
            "For each candidate supplier, served_count = how many of the input companies document it as a supplier " +
            "(directly, or it documents them as a customer — edges are merged from both directions). Ranked by " +
            "served_count descending.",
          caveat:
            `${noSuppliers.length} of ${inputCompanies.length} input companies have zero documented suppliers, so a ` +
            "low overlap number can mean either genuinely few shared suppliers or thin documentation — check " +
            "input_companies_with_no_documented_suppliers_list before concluding low correlation.",
          edge_coverage: edgeCoverage(companies),
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );
};
