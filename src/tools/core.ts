// Core tools 1-9 — extracted from mcp-agent.ts so that file is only the
// Durable Object + init() registration. Same ToolRegistrar contract as the
// other modules under src/tools/.
import { z } from "zod";
import { TAXONOMY_SNAPSHOT_DATE } from "../data";
import { resolveCompany, suppliersOf, customersOf, walkChain } from "../graph";
import { toAllowedCompany } from "../types";
import { attributionForCompany, attributionGeneric, companyUrl, LINKS } from "../attribution";
import { recordUsage } from "../usage";
import {
  jsonResult,
  errorResult,
  companyRef,
  normalizeCountryQuery,
  resolvePartyCompany,
  type ToolRegistrar,
} from "./shared";
import { loadGraph, loadAll } from "./ctxload";

export const registerCoreTools: ToolRegistrar = (server, ctx) => {
  // ---- 1. search_companies -------------------------------------------
  server.registerTool(
    "search_companies",
    {
      title: "Search companies",
      description:
        "Search wafergraph's semiconductor & AI supply-chain company dataset (hundreds of companies across 12 segments) by " +
        "name/one_liner substring and/or segment and/or country. Returns a compact list capped at 25 with a total match count. " +
        "Use get_segments first if you don't know valid segment ids.",
      inputSchema: {
        query: z.string().optional().describe("Case-insensitive substring match against company name and one_liner."),
        segment: z
          .string()
          .optional()
          .describe("Filter to companies with this taxonomy segment id, e.g. 'foundry', 'equipment_front_end' (see get_segments)."),
        country: z.string().optional().describe("Filter to companies headquartered in this country, e.g. 'Taiwan' (case-insensitive)."),
      },
    },
    async ({ query, segment, country }) => {
      void recordUsage(ctx.env, "search_companies", ctx.isSelfTest());
      const { companies } = await loadGraph();
      const q = query?.trim().toLowerCase();
      const seg = segment?.trim().toLowerCase();
      const ctry = country ? normalizeCountryQuery(country) : undefined;

      const matches = companies.filter((c) => {
        if (q && !(c.name.toLowerCase().includes(q) || (c.one_liner ?? "").toLowerCase().includes(q))) return false;
        if (seg && !c.segments.some((s) => s.segment.toLowerCase() === seg)) return false;
        if (ctry && c.country.toLowerCase() !== ctry) return false;
        return true;
      });

      const CAP = 25;
      const results = matches.slice(0, CAP).map((c) => ({
        id: c.id,
        name: c.name,
        ticker: c.ticker,
        segments: c.segments,
        one_liner: c.one_liner,
        company_url: companyUrl(c.id),
      }));

      return jsonResult({
        data: { results, total: matches.length, returned: results.length },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 2. get_company --------------------------------------------------
  server.registerTool(
    "get_company",
    {
      title: "Get company",
      description:
        "Full allowed profile for one company (by id, exact name, or ticker) plus its supplier/customer supply-chain " +
        "edges. Includes key_products (short list of named products/lines). Fields are deliberately limited to " +
        "established/trust-checked data (see README field-discipline note).",
      inputSchema: {
        id: z.string().describe("Company id (snake_case, e.g. 'tsmc'), exact name, or ticker (e.g. 'TSM')."),
        compact: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "If true, return brief company refs (no full AllowedCompany / key_products / one_liner) and cap edges at 25 per side. Default false.",
          ),
      },
    },
    async ({ id, compact }) => {
      void recordUsage(ctx.env, "get_company", ctx.isSelfTest());
      const { graph } = await loadGraph();
      const company = resolveCompany(graph, id);
      if (!company) {
        return errorResult(`No company found for "${id}".`, {
          hint: "Use search_companies to find a valid id, name, or ticker.",
        });
      }

      // Hub companies carry very dense edge lists (memory makers list 175
      // suppliers), which made this response ~32KB — heavy for an LLM
      // context window. Cap each side generously and disclose the
      // truncation; most companies are far under the cap and unchanged.
      // Deeper walks belong to get_supply_chain. compact=true uses a tighter cap.
      const EDGE_CAP = compact ? 25 : 80;
      const supplierIds = suppliersOf(graph, company.id);
      const customerIds = customersOf(graph, company.id);
      const suppliers = supplierIds.slice(0, EDGE_CAP).map((sid) => companyRef(graph, sid));
      const customers = customerIds.slice(0, EDGE_CAP).map((cid) => companyRef(graph, cid));

      const companyPayload = compact
        ? {
            ...companyRef(graph, company.id),
            segments: company.segments,
          }
        : toAllowedCompany(company);

      return jsonResult({
        data: {
          company: companyPayload,
          suppliers,
          customers,
          supplier_count: supplierIds.length,
          customer_count: customerIds.length,
          compact: !!compact,
          ...(supplierIds.length > EDGE_CAP || customerIds.length > EDGE_CAP
            ? { note: `Edge lists capped at ${EDGE_CAP} per side; supplier_count/customer_count carry the true totals. Use get_supply_chain for the full graph.` }
            : {}),
        },
        attribution: attributionForCompany(company.id),
        links: LINKS,
      });
    },
  );

  // ---- 3. get_segments ---------------------------------------------
  server.registerTool(
    "get_segments",
    {
      title: "Get segments",
      description:
        "The wafergraph taxonomy: 12 top-level supply-chain segments (materials through ai_datacenter) and their " +
        "subsegments, each with a live company count, plus the market_position enum. Use this to discover valid " +
        "`segment` values for search_companies/get_deals. Segment definitions are a versioned snapshot (see " +
        "data.taxonomy_snapshot_date) while company counts are computed live.",
      inputSchema: {},
    },
    async () => {
      void recordUsage(ctx.env, "get_segments", ctx.isSelfTest());
      const { companies, taxonomy } = await loadAll();

      const segCount = new Map<string, number>();
      const subCount = new Map<string, number>();
      for (const c of companies) {
        for (const s of c.segments) {
          segCount.set(s.segment, (segCount.get(s.segment) ?? 0) + 1);
          const subKey = `${s.segment}/${s.subsegment}`;
          subCount.set(subKey, (subCount.get(subKey) ?? 0) + 1);
        }
      }

      const segments = [...taxonomy.segments]
        .sort((a, b) => a.order - b.order)
        .map((seg) => ({
          id: seg.id,
          name: seg.name,
          order: seg.order,
          blurb: seg.blurb,
          company_count: segCount.get(seg.id) ?? 0,
          subsegments: seg.subsegments.map((sub) => ({
            id: sub.id,
            name: sub.name,
            company_count: subCount.get(`${seg.id}/${sub.id}`) ?? 0,
          })),
        }));

      return jsonResult({
        data: {
          segments,
          market_position_levels: taxonomy.market_positions,
          total_companies: companies.length,
          taxonomy_snapshot_date: TAXONOMY_SNAPSHOT_DATE,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 4. get_supply_chain ----------------------------------------
  server.registerTool(
    "get_supply_chain",
    {
      title: "Get supply chain",
      description:
        "Walk the supplier/customer graph from one focal company, up to 2 tiers up (suppliers), down (customers), or both. " +
        "Mirrors the chain view on wafergraph.com's Explorer. Returns companies grouped by tier plus the edges between them. " +
        "Pass compact=true when the response would blow an LLM context window (hub firms).",
      inputSchema: {
        id: z.string().describe("Focal company id, name, or ticker."),
        direction: z
          .enum(["up", "down", "both"])
          .default("both")
          .describe("up = walk suppliers only, down = walk customers only, both = walk both directions independently."),
        depth: z.number().int().min(0).max(2).default(2).describe("Number of tiers to walk, capped at 2."),
        compact: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "If true, keep at most 12 companies per tier (already sorted by market cap) and 40 edges among the kept set. Default false.",
          ),
      },
    },
    async ({ id, direction, depth, compact }) => {
      void recordUsage(ctx.env, "get_supply_chain", ctx.isSelfTest());
      const { graph } = await loadGraph();
      const focal = resolveCompany(graph, id);
      if (!focal) {
        return errorResult(`No company found for "${id}".`, {
          hint: "Use search_companies to find a valid id, name, or ticker.",
        });
      }

      const chain = walkChain(graph, focal.id, direction, depth);
      if (!compact) {
        return jsonResult({
          data: { ...chain, compact: false },
          attribution: attributionForCompany(focal.id),
          links: LINKS,
        });
      }

      const PER_TIER = 12;
      const EDGE_CAP = 40;
      const kept = new Set<string>([chain.focal_id]);
      let truncated_tiers = 0;
      const tiers = chain.tiers.map((t) => {
        if (t.companies.length > PER_TIER) truncated_tiers++;
        const companies = t.companies.slice(0, PER_TIER);
        for (const c of companies) kept.add(c.id);
        return {
          tier: t.tier,
          companies,
          tier_total: t.companies.length,
          truncated: t.companies.length > PER_TIER,
        };
      });
      const edgesFull = chain.edges.filter((e) => kept.has(e.from) && kept.has(e.to));
      const edges = edgesFull.slice(0, EDGE_CAP);
      const dual_role_company_ids = chain.dual_role_company_ids.filter((cid) => kept.has(cid));

      return jsonResult({
        data: {
          ...chain,
          tiers,
          edges,
          dual_role_company_ids,
          compact: true,
          total_companies_full: chain.total_companies,
          total_companies: kept.size,
          note:
            (chain.note ? `${chain.note} ` : "") +
            `compact=true: capped at ${PER_TIER} companies/tier` +
            (truncated_tiers ? ` (${truncated_tiers} tier(s) truncated; see tier_total)` : "") +
            ` and ${EDGE_CAP} edges (kept ${edges.length} of ${edgesFull.length} among retained companies). ` +
            `total_companies_full is the uncapped walk size.`,
        },
        attribution: attributionForCompany(focal.id),
        links: LINKS,
      });
    },
  );

  // ---- 5. get_deals -----------------------------------------------------
  server.registerTool(
    "get_deals",
    {
      title: "Get M&A deals",
      description:
        "Search wafergraph's semiconductor & AI supply-chain M&A corpus (74 acquisitions/mergers, including notable " +
        "terminated attempts) by title/summary substring and/or segment. Returns a compact list capped at 30 with a total match count.",
      inputSchema: {
        query: z.string().optional().describe("Case-insensitive substring match against deal title and summary."),
        segment: z
          .string()
          .optional()
          .describe("Filter to deals where at least one named party is a company in this taxonomy segment id."),
      },
    },
    async ({ query, segment }) => {
      void recordUsage(ctx.env, "get_deals", ctx.isSelfTest());
      const { companies, deals, graph } = await loadAll();
      const q = query?.trim().toLowerCase();
      const seg = segment?.trim().toLowerCase();

      const matches = deals.filter((d) => {
        if (q && !((d.title ?? "").toLowerCase().includes(q) || (d.summary ?? "").toLowerCase().includes(q))) return false;
        if (seg) {
          // Match parties by id OR name (null-id parties are common in the corpus).
          const inSegment = d.parties.some((p) => {
            const { company } = resolvePartyCompany(companies, graph, p);
            return !!company?.segments.some((s) => s.segment.toLowerCase() === seg);
          });
          if (!inSegment) return false;
        }
        return true;
      });

      const CAP = 30;
      const results = matches.slice(0, CAP).map((d) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        value_usd: d.value_usd,
        announced: d.announced,
        status: d.status,
        parties: d.parties.map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          ...(p.id ? { company_url: companyUrl(p.id) } : {}),
        })),
        summary: d.summary,
        confidence: d.confidence,
      }));

      return jsonResult({
        data: { results, total: matches.length, returned: results.length },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 6. compare_companies --------------------------------------------
  server.registerTool(
    "compare_companies",
    {
      title: "Compare companies",
      description:
        "Side-by-side comparison of 2-6 companies on the same fields, plus their shared supply-chain " +
        "counterparties (suppliers/customers documented for every company in the set). Cheaper and more aligned " +
        "than several get_company calls when the question is comparative.",
        inputSchema: {
          ids: z
            .array(z.string())
            .min(2)
            .max(6)
            .describe("Company ids, exact names, or tickers. 2-6 of them."),
          compact: z
            .boolean()
            .optional()
            .default(false)
            .describe("If true, return brief company rows (no full AllowedCompany blobs). Default false."),
        },
      },
      async ({ ids, compact }) => {
        void recordUsage(ctx.env, "compare_companies", ctx.isSelfTest());
        const { companies, graph } = await loadGraph();

        const resolved: { input: string; company: (typeof companies)[number] }[] = [];
        const unresolved: string[] = [];
        for (const raw of ids) {
          const c = resolveCompany(graph, raw);
          if (c && !resolved.some((r) => r.company.id === c.id)) resolved.push({ input: raw, company: c });
          else if (!c) unresolved.push(raw);
        }
        if (resolved.length < 2) {
          return errorResult("Need at least 2 resolvable companies to compare.", {
            unresolved,
            hint: "Use search_companies to find valid ids.",
          });
        }

        const rows = resolved.map(({ company: c }) =>
          compact
            ? {
                ...companyRef(graph, c.id),
                segments: c.segments,
                supplier_count: suppliersOf(graph, c.id).length,
                customer_count: customersOf(graph, c.id).length,
              }
            : {
                ...toAllowedCompany(c),
                supplier_count: suppliersOf(graph, c.id).length,
                customer_count: customersOf(graph, c.id).length,
                company_url: companyUrl(c.id),
              },
        );

        // Shared counterparties are the comparative payload an agent actually
        // wants — "what do these two both depend on" is the common question.
        const supplierSets = resolved.map(({ company: c }) => new Set(suppliersOf(graph, c.id)));
        const customerSets = resolved.map(({ company: c }) => new Set(customersOf(graph, c.id)));
        const intersect = (sets: Set<string>[]) =>
          [...(sets[0] ?? [])].filter((id) => sets.every((s) => s.has(id))).map((id) => companyRef(graph, id));

        const priced = rows.filter((r) => r.market_cap_usd_b != null).length;

        return jsonResult({
          data: {
            companies: rows,
            shared_suppliers: intersect(supplierSets),
            shared_customers: intersect(customerSets),
            compact: !!compact,
            ...(unresolved.length ? { unresolved } : {}),
            market_cap_coverage: `${priced}/${rows.length} compared companies have a market cap on file`,
          },
          attribution: attributionGeneric(),
          links: LINKS,
        });
      },
    );

  // ---- 7. get_country_exposure -----------------------------------------
  server.registerTool(
    "get_country_exposure",
    {
      title: "Get country exposure",
      description:
        "Geographic concentration of the supply chain: which countries host the companies in a given segment (or " +
        "across all 12 segments), ranked by company count. Answers 'how concentrated in Taiwan is advanced " +
        "lithography' style questions. Country (headquarters) is recorded for every company in the dataset.",
      inputSchema: {
        segment: z
          .string()
          .optional()
          .describe("Restrict to one taxonomy segment id (see get_segments). Omit for the whole dataset."),
      },
    },
    async ({ segment }) => {
      void recordUsage(ctx.env, "get_country_exposure", ctx.isSelfTest());
      const { companies } = await loadGraph();
      const seg = segment?.trim().toLowerCase();

      const scope = seg ? companies.filter((c) => c.segments.some((s) => s.segment.toLowerCase() === seg)) : companies;
      if (seg && scope.length === 0) {
        return errorResult(`No companies found in segment "${segment}".`, {
          hint: "Use get_segments for the list of valid segment ids.",
        });
      }

      const byCountry = new Map<string, typeof scope>();
      for (const c of scope) {
        const list = byCountry.get(c.country) ?? [];
        list.push(c);
        byCountry.set(c.country, list);
      }

      const countries = [...byCountry.entries()]
        .map(([country, list]) => {
          const priced = list.filter((c) => c.market_cap_usd_b !== null);
          return {
            country,
            company_count: list.length,
            share_of_scope: `${((list.length / scope.length) * 100).toFixed(1)}%`,
            // Summed only over priced companies — disclosed, never implied complete.
            market_cap_usd_b_priced_only: priced.length
              ? Number(priced.reduce((a, c) => a + (c.market_cap_usd_b ?? 0), 0).toFixed(1))
              : null,
            priced_coverage: `${priced.length}/${list.length}`,
            top_companies: list
              .slice()
              .sort((a, b) => (b.market_cap_usd_b ?? -1) - (a.market_cap_usd_b ?? -1))
              .slice(0, 5)
              .map((c) => ({ id: c.id, name: c.name, market_position: c.market_position, company_url: companyUrl(c.id) })),
          };
        })
        .sort((a, b) => b.company_count - a.company_count);

      return jsonResult({
        data: {
          scope: seg ? `segment: ${segment}` : "all segments",
          companies_in_scope: scope.length,
          countries,
          note: "Country is headquarters country, not manufacturing footprint. Market-cap sums cover only companies with a cap on file.",
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 8. find_chokepoints ---------------------------------------------
  server.registerTool(
    "find_chokepoints",
    {
      title: "Find chokepoints",
      description:
        "Rank supply-chain chokepoints: companies many others depend on, weighted by how concentrated their market " +
        "position is. A chokepoint here means high downstream dependency plus monopoly/leader position, i.e. few " +
        "substitutes. Scoring is a transparent heuristic over the public dataset, not a proprietary risk model.",
      inputSchema: {
        segment: z.string().optional().describe("Restrict to one taxonomy segment id (see get_segments)."),
        limit: z.number().int().min(1).max(25).optional().default(10).describe("How many to return (1-25, default 10)."),
      },
    },
    async ({ segment, limit }) => {
      void recordUsage(ctx.env, "find_chokepoints", ctx.isSelfTest());
      const { companies, graph } = await loadGraph();
      const seg = segment?.trim().toLowerCase();

      const scope = seg ? companies.filter((c) => c.segments.some((s) => s.segment.toLowerCase() === seg)) : companies;
      if (seg && scope.length === 0) {
        return errorResult(`No companies found in segment "${segment}".`, {
          hint: "Use get_segments for the list of valid segment ids.",
        });
      }

      // Substitutability weight: the fewer credible alternatives a position
      // implies, the more a dependency on it is a true chokepoint.
      const POSITION_WEIGHT: Record<string, number> = {
        monopoly: 3.0,
        leader: 2.0,
        major: 1.4,
        challenger: 1.0,
        niche: 0.8,
      };

      const ranked = scope
        .map((c) => {
          const dependents = customersOf(graph, c.id);
          const weight = POSITION_WEIGHT[c.market_position] ?? 1.0;
          return {
            id: c.id,
            name: c.name,
            ticker: c.ticker,
            country: c.country,
            market_position: c.market_position,
            segments: c.segments,
            dependent_count: dependents.length,
            substitutability_weight: weight,
            chokepoint_score: Number((dependents.length * weight).toFixed(2)),
            one_liner: c.one_liner,
            company_url: companyUrl(c.id),
          };
        })
        .filter((r) => r.dependent_count > 0)
        .sort((a, b) => b.chokepoint_score - a.chokepoint_score)
        .slice(0, limit ?? 10);

      return jsonResult({
        data: {
          scope: seg ? `segment: ${segment}` : "all segments",
          results: ranked,
          scoring: "chokepoint_score = dependent_count * substitutability_weight (monopoly 3.0, leader 2.0, major 1.4, challenger 1.0, niche 0.8).",
          caveat:
            "dependent_count counts only supplier/customer edges recorded in wafergraph's public dataset, which is " +
            "curated rather than exhaustive. Treat as a ranked starting point for research, not a complete dependency census.",
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 9. analyze_portfolio_exposure -----------------------------------
  server.registerTool(
    "analyze_portfolio_exposure",
    {
      title: "Analyze portfolio exposure",
      description:
        "Given a list of tickers or company ids, report that basket's aggregate exposure across supply-chain segments " +
        "and countries, and flag where holdings share the same upstream suppliers (correlated single points of failure). " +
        "Informational supply-chain analysis over public data, not investment advice.",
      inputSchema: {
        holdings: z
          .array(z.string())
          .min(1)
          .max(40)
          .describe("Tickers (e.g. ['NVDA','TSM']) or company ids. Up to 40."),
      },
    },
    async ({ holdings }) => {
      void recordUsage(ctx.env, "analyze_portfolio_exposure", ctx.isSelfTest());
      const { companies, graph } = await loadGraph();

      const matched: (typeof companies)[number][] = [];
      const unmatched: string[] = [];
      for (const raw of holdings) {
        const c = resolveCompany(graph, raw);
        if (c && !matched.some((m) => m.id === c.id)) matched.push(c);
        else if (!c) unmatched.push(raw);
      }
      if (matched.length === 0) {
        return errorResult("None of the supplied holdings matched a company in the dataset.", {
          unmatched,
          hint: "wafergraph covers hundreds of semiconductor & AI supply-chain companies. Use search_companies to check coverage.",
        });
      }

      const tally = (pairs: string[]) => {
        const m = new Map<string, number>();
        for (const k of pairs) m.set(k, (m.get(k) ?? 0) + 1);
        return [...m.entries()]
          .map(([key, count]) => ({ key, count, share: `${((count / matched.length) * 100).toFixed(1)}%` }))
          .sort((a, b) => b.count - a.count);
      };

      // Suppliers feeding 2+ holdings are the correlated-risk signal.
      const supplierHits = new Map<string, string[]>();
      for (const c of matched) {
        for (const sid of suppliersOf(graph, c.id)) {
          supplierHits.set(sid, [...(supplierHits.get(sid) ?? []), c.id]);
        }
      }
      const sharedSuppliers = [...supplierHits.entries()]
        .filter(([, dependents]) => dependents.length >= 2)
        .map(([sid, dependents]) => ({ ...companyRef(graph, sid), depended_on_by: dependents }))
        .sort((a, b) => b.depended_on_by.length - a.depended_on_by.length);

      return jsonResult({
        data: {
          matched: matched.map((c) => ({ id: c.id, name: c.name, ticker: c.ticker, country: c.country, company_url: companyUrl(c.id) })),
          ...(unmatched.length ? { unmatched } : {}),
          segment_exposure: tally(matched.flatMap((c) => c.segments.map((s) => s.segment))),
          country_exposure: tally(matched.map((c) => c.country)),
          shared_upstream_suppliers: sharedSuppliers,
          interpretation:
            "shared_upstream_suppliers lists companies that more than one holding depends on. Concentration there means " +
            "positions that look diversified may fail together on the same upstream disruption. " +
            "segment_exposure.share is the % of holdings that touch that segment (multi-segment holdings count in " +
            "every segment they touch), so segment shares can sum above 100% — it is not a partition of the portfolio.",
          disclaimer: "Informational supply-chain mapping over public data. Not investment advice.",
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );};
