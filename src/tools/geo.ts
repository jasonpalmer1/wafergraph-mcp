// Geography tools: everything answerable from `Company.country` (a single
// headquarters-country string per company, filled on 100% of the 565
// records) plus the segment/position/graph fields it can be crossed with.
//
// HARD CAVEAT, repeated in every tool's description AND every response
// payload below: `country` is HEADQUARTERS country, not a manufacturing-
// footprint field. A company headquartered in Country A can (and often
// does) fabricate, assemble, or test in Country B. Reading any of these
// five tools as "where the chips are actually made" would be a real
// misread of the data — so every response says so, not just the tool docs.
import { z } from "zod";
import { getCompanies } from "../data";
import { buildGraph, findCompany, suppliersOf, customersOf, type Graph } from "../graph";
import { attributionForCompany, attributionGeneric, LINKS } from "../attribution";
import { recordUsage } from "../usage";
import { jsonResult, errorResult, pricedCoverage, hhi, tallyBy, briefRef, type ToolRegistrar } from "./shared";
import type { Company } from "../types";

const HQ_CAVEAT =
  "country is the company's HEADQUARTERS country only, not a manufacturing-footprint field. A company " +
  "headquartered here may fabricate, assemble, or test elsewhere — do not read this data as production geography.";

const POSITION_ORDER = ["monopoly", "leader", "major", "challenger", "niche"] as const;
const POSITION_RANK: Record<string, number> = { monopoly: 0, leader: 1, major: 2, challenger: 3, niche: 4 };

function positionCounts(list: Company[]): Array<{ position: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of list) counts.set(c.market_position, (counts.get(c.market_position) ?? 0) + 1);
  return POSITION_ORDER.map((p) => ({ position: p, count: counts.get(p) ?? 0 }));
}

// Small set of obvious aliases for a 29-country dataset. Matching itself is
// always case-insensitive exact-string against the real values found live in
// companies.json (see the report back to the caller for the full list) —
// this only maps common shorthands onto those real strings.
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "united states",
  us: "united states",
  "u.s.": "united states",
  "u.s.a.": "united states",
  america: "united states",
  uk: "united kingdom",
  "u.k.": "united kingdom",
  britain: "united kingdom",
  "great britain": "united kingdom",
  korea: "south korea",
  "republic of korea": "south korea",
  "rok": "south korea",
  czechia: "czech republic",
};

function normalizeCountryQuery(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return COUNTRY_ALIASES[trimmed] ?? trimmed;
}

function allCountries(companies: Company[]): string[] {
  return [...new Set(companies.map((c) => c.country))];
}

function resolveCountry(companies: Company[], raw: string): string | undefined {
  const target = normalizeCountryQuery(raw);
  return allCountries(companies).find((c) => c.toLowerCase() === target);
}

// Plain Levenshtein distance, used only to rank close-match suggestions when
// a country lookup misses — the dataset is 29 countries, so this is cheap.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function suggestCountries(companies: Company[], raw: string, limit = 3): string[] {
  const target = normalizeCountryQuery(raw);
  return allCountries(companies)
    .map((c) => ({ c, d: levenshtein(target, c.toLowerCase()) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.c);
}

function distinctSegments(companies: Company[]): string[] {
  const s = new Set<string>();
  for (const c of companies) for (const seg of c.segments) s.add(seg.segment);
  return [...s];
}

function segmentCompanyCount(companies: Company[], segId: string): number {
  return companies.filter((c) => c.segments.some((s) => s.segment.toLowerCase() === segId)).length;
}

export const registerGeoTools: ToolRegistrar = (server, ctx) => {
  // ---- 1. list_countries -------------------------------------------------
  server.registerTool(
    "list_countries",
    {
      title: "List countries",
      description:
        "Every country in wafergraph's semiconductor & AI supply-chain dataset (29 countries across 565 companies) " +
        "with company count, which segments are present there (with counts), public/private split, and priced " +
        "market-cap totals. Sorted by company count descending. Optional segment filter. " +
        HQ_CAVEAT,
      inputSchema: {
        segment: z
          .string()
          .optional()
          .describe(
            "Restrict to companies with this taxonomy segment id, e.g. 'foundry', 'memory' (see get_segments). Case-insensitive. Omit for all segments.",
          ),
      },
    },
    async ({ segment }) => {
      await recordUsage(ctx.env, "list_countries", ctx.isSelfTest());
      const companies = await getCompanies();
      const seg = segment?.trim().toLowerCase();

      const scope = seg ? companies.filter((c) => c.segments.some((s) => s.segment.toLowerCase() === seg)) : companies;
      if (seg && scope.length === 0) {
        return errorResult(`No companies found in segment "${segment}".`, {
          valid_segments: distinctSegments(companies).sort(),
          hint: "Use get_segments for the full list of valid segment ids with names/blurbs.",
        });
      }

      const byCountry = new Map<string, Company[]>();
      for (const c of scope) {
        const list = byCountry.get(c.country) ?? [];
        list.push(c);
        byCountry.set(c.country, list);
      }

      const CAP = 40; // dataset has 29 countries max; capped defensively per house rule
      const allRows = [...byCountry.entries()]
        .map(([country, list]) => ({
          country,
          company_count: list.length,
          public_count: list.filter((c) => c.public).length,
          private_count: list.filter((c) => !c.public).length,
          segments_present: tallyBy(list, (c) => c.segments.map((s) => s.segment)),
          market_cap: pricedCoverage(list),
        }))
        .sort((a, b) => b.company_count - a.company_count);
      const countries = allRows.slice(0, CAP);

      return jsonResult({
        data: {
          scope: seg ? `segment: ${segment}` : "all segments",
          companies_in_scope: scope.length,
          countries,
          total: allRows.length,
          returned: countries.length,
          caveat: HQ_CAVEAT,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 2. get_country_profile ---------------------------------------------
  server.registerTool(
    "get_country_profile",
    {
      title: "Get country profile",
      description:
        "Deep profile of one country's presence in wafergraph's semiconductor & AI supply-chain dataset: company " +
        "count, segment breakdown, market-position breakdown, top companies by market cap, notable monopoly/leader " +
        "companies, and inbound/outbound supplier-relationship edge counts across this country's border (computed " +
        "from the supply-chain graph). " +
        HQ_CAVEAT,
      inputSchema: {
        country: z.string().describe("Country name, e.g. 'Taiwan', 'United States', 'South Korea'. Case-insensitive; common short forms (USA, UK, Korea) are recognized."),
      },
    },
    async ({ country }) => {
      await recordUsage(ctx.env, "get_country_profile", ctx.isSelfTest());
      const companies = await getCompanies();
      const resolved = resolveCountry(companies, country);
      if (!resolved) {
        return errorResult(`No country found matching "${country}".`, {
          suggestions: suggestCountries(companies, country),
          hint: "Use list_countries for the full list of 29 countries in the dataset.",
        });
      }

      const inCountry = companies.filter((c) => c.country === resolved);
      const graph = buildGraph(companies);

      const TOP_CAP = 15;
      const sortedByCap = [...inCountry].sort((a, b) => (b.market_cap_usd_b ?? -1) - (a.market_cap_usd_b ?? -1));
      const topCompanies = sortedByCap.slice(0, TOP_CAP).map((c) => briefRef(c));

      const NOTABLE_CAP = 25;
      const monopolyOrLeader = inCountry
        .filter((c) => c.market_position === "monopoly" || c.market_position === "leader")
        .sort((a, b) => POSITION_RANK[a.market_position] - POSITION_RANK[b.market_position] || (b.market_cap_usd_b ?? -1) - (a.market_cap_usd_b ?? -1));
      const notableLeaders = monopolyOrLeader.slice(0, NOTABLE_CAP).map((c) => ({ ...briefRef(c), segments: c.segments.map((s) => s.segment) }));

      // Cross-border edge counts. Each directed supplier(from)->customer(to)
      // edge in the graph is visited exactly once, from the "from" side, so
      // there is no double-counting between domestic/outbound/inbound.
      let outboundEdges = 0; // this country supplying companies headquartered elsewhere
      let inboundEdges = 0; // this country's companies buying from suppliers headquartered elsewhere
      let domesticEdges = 0; // both ends headquartered in this country
      for (const c of inCountry) {
        for (const toId of customersOf(graph, c.id)) {
          const to = graph.byId.get(toId);
          if (!to) continue;
          if (to.country === resolved) domesticEdges++;
          else outboundEdges++;
        }
        for (const fromId of suppliersOf(graph, c.id)) {
          const from = graph.byId.get(fromId);
          if (!from) continue;
          if (from.country !== resolved) inboundEdges++;
        }
      }

      return jsonResult({
        data: {
          country: resolved,
          company_count: inCountry.length,
          public_count: inCountry.filter((c) => c.public).length,
          private_count: inCountry.filter((c) => !c.public).length,
          segment_breakdown: tallyBy(inCountry, (c) => c.segments.map((s) => s.segment)),
          position_breakdown: positionCounts(inCountry),
          market_cap: pricedCoverage(inCountry),
          top_companies: {
            results: topCompanies,
            total: inCountry.length,
            returned: topCompanies.length,
          },
          notable_monopoly_or_leader_companies: {
            results: notableLeaders,
            total: monopolyOrLeader.length,
            returned: notableLeaders.length,
          },
          cross_border_supply_edges: {
            outbound_edges: outboundEdges,
            inbound_edges: inboundEdges,
            domestic_edges: domesticEdges,
            methodology:
              "Counts of directed supplier->customer edges in wafergraph's merged supply-chain graph (deduped, both " +
              "key_suppliers and key_customers listings folded into one edge set). outbound = this country's " +
              "companies supplying a customer headquartered elsewhere; inbound = this country's companies buying " +
              "from a supplier headquartered elsewhere; domestic = both ends headquartered here.",
            caveat:
              "The graph reflects only the supplier/customer relationships wafergraph has curated (key_suppliers is " +
              "~58% filled dataset-wide), so these counts are a floor on real cross-border trade, not a census of it.",
          },
          caveat: HQ_CAVEAT,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 3. compare_countries -------------------------------------------------
  server.registerTool(
    "compare_countries",
    {
      title: "Compare countries",
      description:
        "Side-by-side comparison of 2-5 countries: aligned rows for company count, segment mix, market-position mix, " +
        "and priced market cap, plus which segments each country is uniquely present in or dominant in, and which " +
        "segments they all share. " +
        HQ_CAVEAT,
      inputSchema: {
        countries: z
          .array(z.string())
          .min(2)
          .max(5)
          .describe("2-5 country names, e.g. ['Taiwan','South Korea','United States']. Case-insensitive; common short forms recognized."),
      },
    },
    async ({ countries }) => {
      await recordUsage(ctx.env, "compare_countries", ctx.isSelfTest());
      const companies = await getCompanies();

      const resolved: string[] = [];
      const unresolved: Array<{ input: string; suggestions: string[] }> = [];
      for (const raw of countries) {
        const r = resolveCountry(companies, raw);
        if (r && !resolved.includes(r)) resolved.push(r);
        else if (!r) unresolved.push({ input: raw, suggestions: suggestCountries(companies, raw) });
      }
      if (resolved.length < 2) {
        return errorResult("Need at least 2 resolvable countries to compare.", {
          unresolved,
          hint: "Use list_countries for the full list of 29 countries in the dataset.",
        });
      }

      const byCountry = new Map<string, Company[]>(resolved.map((country) => [country, companies.filter((c) => c.country === country)]));

      const rows = resolved.map((country) => {
        const list = byCountry.get(country)!;
        return {
          country,
          company_count: list.length,
          public_count: list.filter((c) => c.public).length,
          private_count: list.filter((c) => !c.public).length,
          segment_mix: tallyBy(list, (c) => c.segments.map((s) => s.segment)),
          position_mix: positionCounts(list),
          market_cap: pricedCoverage(list),
        };
      });

      // Segment presence per compared country, for uniqueness/dominance/shared.
      const segCountByCountry = new Map<string, Map<string, number>>();
      for (const country of resolved) {
        const m = new Map<string, number>();
        for (const c of byCountry.get(country)!) for (const s of c.segments) m.set(s.segment, (m.get(s.segment) ?? 0) + 1);
        segCountByCountry.set(country, m);
      }
      const allSegIds = new Set<string>();
      for (const m of segCountByCountry.values()) for (const segId of m.keys()) allSegIds.add(segId);

      const perCountryFindings = resolved.map((country) => {
        const mine = segCountByCountry.get(country)!;
        const uniquelyPresent: string[] = [];
        const dominant: string[] = [];
        for (const segId of allSegIds) {
          const myCount = mine.get(segId) ?? 0;
          if (myCount === 0) continue;
          const others = resolved.filter((c) => c !== country).map((c) => segCountByCountry.get(c)!.get(segId) ?? 0);
          if (others.every((n) => n === 0)) uniquelyPresent.push(segId);
          else if (others.every((n) => myCount > n)) dominant.push(segId);
        }
        return { country, uniquely_present_segments: uniquelyPresent, dominant_segments: dominant };
      });

      const sharedSegments = [...allSegIds].filter((segId) => resolved.every((country) => (segCountByCountry.get(country)!.get(segId) ?? 0) > 0));

      return jsonResult({
        data: {
          countries: rows,
          per_country_segment_findings: perCountryFindings,
          shared_segments: sharedSegments,
          methodology:
            "uniquely_present_segments: segments where this country has >=1 company and every other compared country " +
            "has zero. dominant_segments: segments where this country's company count strictly exceeds every other " +
            "compared country's count in that segment. shared_segments: segments where every compared country has " +
            "at least one company.",
          ...(unresolved.length ? { unresolved } : {}),
          caveat: HQ_CAVEAT,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 4. get_segment_leaders -----------------------------------------------
  server.registerTool(
    "get_segment_leaders",
    {
      title: "Get segment leaders",
      description:
        "Who runs a given layer of the semiconductor & AI supply chain: the companies at monopoly/leader market " +
        "position in one taxonomy segment (or all 12 if none given), with country and market cap, plus a count of " +
        "how many companies sit at each position (monopoly/leader/major/challenger/niche) in that segment. " +
        HQ_CAVEAT,
      inputSchema: {
        segment: z
          .string()
          .optional()
          .describe("A taxonomy segment id, e.g. 'foundry', 'eda_ip' (see get_segments). Case-insensitive. Omit to cover all 12 segments."),
      },
    },
    async ({ segment }) => {
      await recordUsage(ctx.env, "get_segment_leaders", ctx.isSelfTest());
      const companies = await getCompanies();
      const seg = segment?.trim().toLowerCase();

      let segIds: string[];
      if (seg) {
        if (segmentCompanyCount(companies, seg) === 0) {
          return errorResult(`No companies found in segment "${segment}".`, {
            valid_segments: distinctSegments(companies).sort(),
            hint: "Use get_segments for the full list of valid segment ids with names/blurbs.",
          });
        }
        segIds = [seg];
      } else {
        segIds = distinctSegments(companies).sort((a, b) => segmentCompanyCount(companies, b) - segmentCompanyCount(companies, a));
      }

      const LEADERS_CAP = 30;
      const segments = segIds.map((segId) => {
        const inSegment = companies.filter((c) => c.segments.some((s) => s.segment.toLowerCase() === segId));
        const leaderCandidates = inSegment
          .filter((c) => c.market_position === "monopoly" || c.market_position === "leader")
          .sort((a, b) => POSITION_RANK[a.market_position] - POSITION_RANK[b.market_position] || (b.market_cap_usd_b ?? -1) - (a.market_cap_usd_b ?? -1));
        const leaders = leaderCandidates.slice(0, LEADERS_CAP).map((c) => ({ ...briefRef(c), one_liner: c.one_liner }));
        return {
          segment: segId,
          company_count: inSegment.length,
          position_counts: positionCounts(inSegment),
          leaders: {
            results: leaders,
            total: leaderCandidates.length,
            returned: leaders.length,
          },
        };
      });

      return jsonResult({
        data: {
          scope: seg ? `segment: ${seg}` : "all 12 segments",
          segments,
          total: segments.length,
          returned: segments.length,
          caveat: HQ_CAVEAT,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 5. get_upstream_concentration -----------------------------------------
  server.registerTool(
    "get_upstream_concentration",
    {
      title: "Get upstream concentration",
      description:
        "For one focal company: break its suppliers down by headquarters country and by segment, report an HHI " +
        "concentration index (0 = spread evenly, 1 = fully concentrated in one bucket) for each dimension, and name " +
        "the single most concentrated one. Always reports supplier_edge_coverage because key_suppliers is only ~58% " +
        "filled dataset-wide — a company with few listed suppliers here may be under-documented, not genuinely " +
        "un-dependent. " +
        HQ_CAVEAT,
      inputSchema: {
        id: z.string().describe("Focal company id (snake_case, e.g. 'tsmc') or exact company name."),
      },
    },
    async ({ id }) => {
      await recordUsage(ctx.env, "get_upstream_concentration", ctx.isSelfTest());
      const companies = await getCompanies();
      const graph: Graph = buildGraph(companies);
      const focal = findCompany(graph, id);
      if (!focal) {
        return errorResult(`No company found for "${id}".`, {
          hint: "Use search_companies to find a valid id or name.",
        });
      }

      const supplierIds = suppliersOf(graph, focal.id);
      const supplierCompanies = supplierIds.map((sid) => graph.byId.get(sid)).filter((c): c is Company => !!c);

      const byCountry = tallyBy(supplierCompanies, (c) => c.country);
      const bySegment = tallyBy(supplierCompanies, (c) => c.segments.map((s) => s.segment));
      const hhiCountry = hhi(byCountry.map((x) => x.count));
      const hhiSegment = hhi(bySegment.map((x) => x.count));

      let mostConcentratedDimension: string;
      if (supplierCompanies.length === 0) {
        mostConcentratedDimension = "none — no supplier edges recorded for this company";
      } else if (hhiCountry === hhiSegment) {
        mostConcentratedDimension = "tied — country and segment concentration are equal";
      } else {
        mostConcentratedDimension = hhiCountry > hhiSegment ? "country" : "segment";
      }

      const withKeySuppliers = companies.filter((c) => (c.key_suppliers?.length ?? 0) > 0).length;
      const datasetWideFillRate = companies.length ? Number((withKeySuppliers / companies.length).toFixed(3)) : 0;

      return jsonResult({
        data: {
          focal_company: { id: focal.id, name: focal.name, country: focal.country, market_position: focal.market_position },
          supplier_count: supplierCompanies.length,
          by_country: byCountry,
          by_segment: bySegment,
          concentration: {
            hhi_by_country: hhiCountry,
            hhi_by_segment: hhiSegment,
            most_concentrated_dimension: mostConcentratedDimension,
            methodology:
              "HHI = sum over buckets of (bucket_supplier_count / total_supplier_count)^2, computed separately for " +
              "the country grouping and the segment grouping. 0 means suppliers are evenly spread across many " +
              "buckets; 1 means every supplier falls in a single bucket. by_segment counts can sum to more than " +
              "supplier_count because a supplier can belong to more than one segment.",
          },
          supplier_edge_coverage: {
            dataset_wide_key_suppliers_fill_rate: datasetWideFillRate,
            this_company_listed_key_suppliers: focal.key_suppliers?.length ?? 0,
            caveat:
              "key_suppliers is only filled for roughly " + Math.round(datasetWideFillRate * 100) + "% of companies " +
              "dataset-wide. A low supplier_count above may reflect under-documentation of this company's upstream " +
              "relationships rather than genuine low dependency — absence of a listed supplier is not evidence of " +
              "self-sufficiency.",
          },
          caveat: HQ_CAVEAT,
        },
        attribution: attributionForCompany(focal.id),
        links: LINKS,
      });
    },
  );
};
