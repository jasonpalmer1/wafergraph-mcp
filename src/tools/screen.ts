// Structured screening tools over wafergraph's company dataset — the
// counterpart to the fuzzy search_companies tool. Where search_companies
// does a substring text match, everything here does exact/range filtering,
// ranking, and structural comparison suited to multi-criteria screens.
//
// No new data dependencies: reads the same getCompanies()/getTaxonomy() as
// the rest of the server. Follows the pattern in mcp-agent.ts and reuses the
// helpers in ./shared.ts (jsonResult/errorResult/briefRef/pricedCoverage/
// tallyBy) rather than re-deriving them.
import { z } from "zod";
import { getCompanies, getTaxonomy, TAXONOMY_SNAPSHOT_DATE } from "../data";
import { buildGraph, findCompany, suppliersOf, customersOf } from "../graph";
import type { Company } from "../types";
import { attributionForCompany, attributionGeneric, LINKS } from "../attribution";
import { recordUsage } from "../usage";
import { jsonResult, errorResult, briefRef, pricedCoverage, tallyBy, type ToolRegistrar } from "./shared";

const MARKET_POSITIONS = ["monopoly", "leader", "major", "challenger", "niche"] as const;

// Nulls-last market-cap comparator, shared by the tools below that rank or
// list companies by cap.
function byMarketCapDesc(a: Company, b: Company): number {
  const av = a.market_cap_usd_b;
  const bv = b.market_cap_usd_b;
  if (av == null && bv == null) return a.name.localeCompare(b.name);
  if (av == null) return 1;
  if (bv == null) return -1;
  return bv - av;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : Number((inter / union).toFixed(4));
}

export const registerScreenTools: ToolRegistrar = (server, ctx) => {
  // ---- filter_companies -------------------------------------------------
  server.registerTool(
    "filter_companies",
    {
      title: "Filter companies",
      description:
        "Structured multi-criteria screen over all 565 companies: exact segment/subsegment/country/market_position/" +
        "public filters plus a market-cap range, sortable and paginated. Use this instead of search_companies when " +
        "the question is a precise filter ('leader-position analog companies in Japan under $20B') rather than a " +
        "free-text match. Unknown segment/subsegment/country values just return zero results rather than erroring — " +
        "call get_segments or list_subsegments first if you're not sure a value is valid.",
      inputSchema: {
        segment: z.string().optional().describe("Exact taxonomy segment id, e.g. 'foundry' (see get_segments)."),
        subsegment: z.string().optional().describe("Exact taxonomy subsegment id, e.g. 'litho' (see list_subsegments)."),
        country: z.string().optional().describe("Headquarters country, exact match, case-insensitive, e.g. 'Japan'."),
        market_position: z
          .enum(MARKET_POSITIONS)
          .optional()
          .describe("Exact market_position: monopoly | leader | major | challenger | niche."),
        public: z.boolean().optional().describe("true = only publicly traded companies, false = only private ones. Omit for both."),
        min_market_cap_usd_b: z.number().optional().describe("Minimum market cap in USD billions (inclusive). Only ~72% of companies have a cap on file — see the response note when this is set."),
        max_market_cap_usd_b: z.number().optional().describe("Maximum market cap in USD billions (inclusive). Only ~72% of companies have a cap on file — see the response note when this is set."),
        has_ticker: z.boolean().optional().describe("true = only companies with a public ticker on file, false = only companies without one."),
        sort_by: z
          .enum(["market_cap", "name", "country"])
          .optional()
          .default("market_cap")
          .describe("Sort field. 'market_cap' sorts descending with unpriced companies last; 'name'/'country' sort ascending. Default 'market_cap'."),
        limit: z.number().int().min(1).max(100).optional().default(25).describe("Max rows to return, 1-100. Default 25."),
        offset: z.number().int().min(0).optional().default(0).describe("Rows to skip, for paging past the first `limit`. Default 0."),
      },
    },
    async ({ segment, subsegment, country, market_position, public: isPublic, min_market_cap_usd_b, max_market_cap_usd_b, has_ticker, sort_by, limit, offset }) => {
      await recordUsage(ctx.env, "filter_companies", ctx.isSelfTest());
      const companies = await getCompanies();

      const seg = segment?.trim().toLowerCase();
      const sub = subsegment?.trim().toLowerCase();
      const ctry = country?.trim().toLowerCase();

      const scope = companies.filter((c) => {
        if (seg && !c.segments.some((s) => s.segment.toLowerCase() === seg)) return false;
        if (sub && !c.segments.some((s) => s.subsegment.toLowerCase() === sub)) return false;
        if (ctry && c.country.toLowerCase() !== ctry) return false;
        if (market_position && c.market_position !== market_position) return false;
        if (typeof isPublic === "boolean" && c.public !== isPublic) return false;
        if (typeof min_market_cap_usd_b === "number" && !(typeof c.market_cap_usd_b === "number" && c.market_cap_usd_b >= min_market_cap_usd_b)) return false;
        if (typeof max_market_cap_usd_b === "number" && !(typeof c.market_cap_usd_b === "number" && c.market_cap_usd_b <= max_market_cap_usd_b)) return false;
        if (has_ticker === true && !c.ticker) return false;
        if (has_ticker === false && !!c.ticker) return false;
        return true;
      });

      const sortField = sort_by ?? "market_cap";
      const sorted = [...scope].sort((a, b) => {
        if (sortField === "name") return a.name.localeCompare(b.name);
        if (sortField === "country") return a.country.localeCompare(b.country) || a.name.localeCompare(b.name);
        return byMarketCapDesc(a, b);
      });

      const off = Math.max(offset ?? 0, 0);
      const lim = Math.min(Math.max(limit ?? 25, 1), 100);
      const results = sorted.slice(off, off + lim).map(briefRef);

      const capFilterUsed = min_market_cap_usd_b !== undefined || max_market_cap_usd_b !== undefined;

      return jsonResult({
        data: {
          filters_applied: {
            segment: segment ?? null,
            subsegment: subsegment ?? null,
            country: country ?? null,
            market_position: market_position ?? null,
            public: isPublic ?? null,
            min_market_cap_usd_b: min_market_cap_usd_b ?? null,
            max_market_cap_usd_b: max_market_cap_usd_b ?? null,
            has_ticker: has_ticker ?? null,
            sort_by: sortField,
          },
          results,
          total: scope.length,
          returned: results.length,
          offset: off,
          ...(capFilterUsed
            ? {
                note:
                  "A market-cap bound was applied. About 28% of companies in this dataset have no market_cap_usd_b " +
                  "on file, and a null value can't satisfy either min_market_cap_usd_b or max_market_cap_usd_b — " +
                  "those companies are silently excluded by this filter, not just ranked last.",
              }
            : {}),
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- list_subsegments ---------------------------------------------------
  server.registerTool(
    "list_subsegments",
    {
      title: "List subsegments",
      description:
        "Every subsegment across wafergraph's 12-segment taxonomy, each with its live company count and parent " +
        "segment id/name, optionally filtered to one segment. Use this (or get_segments) to discover valid " +
        "`subsegment` values before calling get_subsegment or filter_companies. Segment/subsegment names come from a " +
        "versioned taxonomy snapshot; company counts are computed live and can include subsegment ids present in the " +
        "company data but not yet in that snapshot (flagged `in_taxonomy: false`).",
      inputSchema: {
        segment: z.string().optional().describe("Restrict to subsegments of this taxonomy segment id, e.g. 'materials'. Omit for all 12 segments."),
      },
    },
    async ({ segment }) => {
      await recordUsage(ctx.env, "list_subsegments", ctx.isSelfTest());
      const [taxonomy, companies] = await Promise.all([getTaxonomy(), getCompanies()]);
      const segFilter = segment?.trim().toLowerCase();

      const segNameById = new Map(taxonomy.segments.map((s) => [s.id, s.name]));

      const counts = new Map<string, number>();
      for (const c of companies) {
        for (const s of c.segments) {
          const key = `${s.segment}::${s.subsegment}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }

      interface Row {
        segment_id: string;
        segment_name: string | null;
        subsegment_id: string;
        subsegment_name: string;
        company_count: number;
        in_taxonomy: boolean;
      }
      const rows: Row[] = [];
      const seenKeys = new Set<string>();

      for (const seg of taxonomy.segments) {
        if (segFilter && seg.id.toLowerCase() !== segFilter) continue;
        for (const sub of seg.subsegments) {
          const key = `${seg.id}::${sub.id}`;
          seenKeys.add(key);
          rows.push({
            segment_id: seg.id,
            segment_name: seg.name,
            subsegment_id: sub.id,
            subsegment_name: sub.name,
            company_count: counts.get(key) ?? 0,
            in_taxonomy: true,
          });
        }
      }

      // Subsegments that show up in live company data but aren't in the
      // vendored taxonomy snapshot — include them rather than silently drop
      // real companies from the picture, but flag the mismatch.
      for (const [key, count] of counts) {
        if (seenKeys.has(key)) continue;
        const sepIdx = key.indexOf("::");
        const segId = key.slice(0, sepIdx);
        const subId = key.slice(sepIdx + 2);
        if (segFilter && segId.toLowerCase() !== segFilter) continue;
        rows.push({
          segment_id: segId,
          segment_name: segNameById.get(segId) ?? null,
          subsegment_id: subId,
          subsegment_name: subId,
          company_count: count,
          in_taxonomy: false,
        });
      }

      if (segFilter && rows.length === 0) {
        return errorResult(`No subsegments found for segment "${segment}".`, {
          hint: "Use get_segments for the list of valid segment ids.",
        });
      }

      rows.sort((a, b) => b.company_count - a.company_count);

      return jsonResult({
        data: {
          scope: segFilter ? `segment: ${segment}` : "all segments",
          subsegments: rows,
          total: rows.length,
          returned: rows.length,
          taxonomy_snapshot_date: TAXONOMY_SNAPSHOT_DATE,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- get_subsegment -------------------------------------------------
  server.registerTool(
    "get_subsegment",
    {
      title: "Get subsegment",
      description:
        "All companies in one segment+subsegment pair, as compact refs sorted by market cap descending, plus a " +
        "market_position breakdown and a country breakdown computed over the FULL matching set (not just the " +
        "returned page). Use list_subsegments first if you don't know valid segment/subsegment ids.",
      inputSchema: {
        segment: z.string().describe("Taxonomy segment id, e.g. 'equipment_front_end' (see get_segments)."),
        subsegment: z.string().describe("Taxonomy subsegment id within that segment, e.g. 'litho' (see list_subsegments)."),
        limit: z.number().int().min(1).max(100).optional().default(50).describe("Max companies to return, 1-100. Default 50."),
        offset: z.number().int().min(0).optional().default(0).describe("Companies to skip, for paging past the first `limit`. Default 0."),
      },
    },
    async ({ segment, subsegment, limit, offset }) => {
      await recordUsage(ctx.env, "get_subsegment", ctx.isSelfTest());
      const [taxonomy, companies] = await Promise.all([getTaxonomy(), getCompanies()]);
      const segId = segment.trim().toLowerCase();
      const subId = subsegment.trim().toLowerCase();

      const matches = companies.filter((c) => c.segments.some((s) => s.segment.toLowerCase() === segId && s.subsegment.toLowerCase() === subId));
      if (matches.length === 0) {
        return errorResult(`No companies found in subsegment "${subsegment}" under segment "${segment}".`, {
          hint: "Use list_subsegments (optionally with `segment` set) to see valid segment/subsegment pairs and their counts.",
        });
      }

      const taxSeg = taxonomy.segments.find((s) => s.id.toLowerCase() === segId);
      const taxSub = taxSeg?.subsegments.find((s) => s.id.toLowerCase() === subId);

      const sorted = [...matches].sort(byMarketCapDesc);
      const off = Math.max(offset ?? 0, 0);
      const lim = Math.min(Math.max(limit ?? 50, 1), 100);
      const page = sorted.slice(off, off + lim).map(briefRef);

      return jsonResult({
        data: {
          segment_id: segId,
          segment_name: taxSeg?.name ?? null,
          subsegment_id: subId,
          subsegment_name: taxSub?.name ?? subId,
          in_taxonomy: !!taxSub,
          companies: page,
          total: matches.length,
          returned: page.length,
          offset: off,
          position_breakdown: tallyBy(matches, (c) => c.market_position),
          country_breakdown: tallyBy(matches, (c) => c.country),
          taxonomy_snapshot_date: TAXONOMY_SNAPSHOT_DATE,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- find_similar_companies ---------------------------------------------
  server.registerTool(
    "find_similar_companies",
    {
      title: "Find similar companies",
      description:
        "Nearest structural neighbours to one focal company, ranked by a transparent Jaccard-similarity score — not a " +
        "market or competitive judgment. Use search_companies or resolve_ticker first if you only have a ticker or an " +
        "approximate name, then pass the resolved id here.",
      inputSchema: {
        id: z.string().describe("Focal company id (snake_case, e.g. 'tsmc') or exact name to find neighbours for."),
        limit: z.number().int().min(1).max(25).optional().default(10).describe("How many similar companies to return, 1-25. Default 10."),
      },
    },
    async ({ id, limit }) => {
      await recordUsage(ctx.env, "find_similar_companies", ctx.isSelfTest());
      const companies = await getCompanies();
      const graph = buildGraph(companies);
      const focal = findCompany(graph, id);
      if (!focal) {
        return errorResult(`No company found for "${id}".`, {
          hint: "Use search_companies or resolve_ticker to find a valid id or name.",
        });
      }

      const pairsOf = (c: Company) => new Set(c.segments.map((s) => `${s.segment}:${s.subsegment}`));
      const supplyCounterpartiesOf = (cid: string) => new Set([...suppliersOf(graph, cid), ...customersOf(graph, cid)]);

      const focalPairs = pairsOf(focal);
      const focalCounterparties = supplyCounterpartiesOf(focal.id);

      const scored = companies
        .filter((c) => c.id !== focal.id)
        .map((c) => {
          const segment_jaccard = jaccard(focalPairs, pairsOf(c));
          const supplier_customer_jaccard = jaccard(focalCounterparties, supplyCounterpartiesOf(c.id));
          const score = Number(((segment_jaccard + supplier_customer_jaccard) / 2).toFixed(4));
          return { company: c, segment_jaccard, supplier_customer_jaccard, score };
        })
        .sort(
          (a, b) =>
            b.score - a.score ||
            (b.company.market_cap_usd_b ?? -1) - (a.company.market_cap_usd_b ?? -1) ||
            a.company.name.localeCompare(b.company.name),
        );

      const lim = Math.min(Math.max(limit ?? 10, 1), 25);
      const results = scored.slice(0, lim).map((r) => ({
        ...briefRef(r.company),
        segment_jaccard: r.segment_jaccard,
        supplier_customer_jaccard: r.supplier_customer_jaccard,
        score: r.score,
      }));

      return jsonResult({
        data: {
          focal: briefRef(focal),
          results,
          total: scored.length,
          returned: results.length,
          methodology:
            "score = average of two Jaccard similarities. (1) segment_jaccard: Jaccard(A,B) over each company's set of " +
            "segment:subsegment tags. (2) supplier_customer_jaccard: Jaccard(A,B) over the union of each company's " +
            "suppliers and customers in wafergraph's merged supply-chain graph (the same bidirectional edges " +
            "get_supply_chain walks, not just its own listed key_suppliers/key_customers fields). Jaccard(A,B) = " +
            "|A intersect B| / |A union B|, and is defined as 0 when both sets are empty.",
          caveat:
            "This is a structural similarity over a curated public dataset — shared taxonomy tags and shared named " +
            "counterparties — not a market, financial, or competitive judgment. key_suppliers is only ~58% filled " +
            "(key_customers ~81%), so a low supplier_customer_jaccard can reflect missing source data rather than " +
            "genuine dissimilarity.",
        },
        attribution: attributionForCompany(focal.id),
        links: LINKS,
      });
    },
  );

  // ---- rank_by_market_cap -----------------------------------------------
  server.registerTool(
    "rank_by_market_cap",
    {
      title: "Rank by market cap",
      description:
        "Top N companies by market cap, optionally restricted to a segment/country/market_position, with the priced-" +
        "coverage ratio for that scope attached — about 28% of companies dataset-wide have no market_cap_usd_b on " +
        "file, so a plain top-N list without the coverage number would look more complete than it is.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().default(10).describe("How many companies to return, ranked highest market cap first, 1-100. Default 10."),
        segment: z.string().optional().describe("Restrict to one taxonomy segment id (see get_segments)."),
        country: z.string().optional().describe("Restrict to companies headquartered in this country, case-insensitive."),
        market_position: z.enum(MARKET_POSITIONS).optional().describe("Restrict to companies at this market_position."),
      },
    },
    async ({ limit, segment, country, market_position }) => {
      await recordUsage(ctx.env, "rank_by_market_cap", ctx.isSelfTest());
      const companies = await getCompanies();
      const seg = segment?.trim().toLowerCase();
      const ctry = country?.trim().toLowerCase();

      const scope = companies.filter((c) => {
        if (seg && !c.segments.some((s) => s.segment.toLowerCase() === seg)) return false;
        if (ctry && c.country.toLowerCase() !== ctry) return false;
        if (market_position && c.market_position !== market_position) return false;
        return true;
      });

      if (scope.length === 0) {
        return errorResult("No companies matched that segment/country/market_position combination.", {
          hint: "Use get_segments or get_country_exposure to check valid segment/country values.",
        });
      }

      const lim = Math.min(Math.max(limit ?? 10, 1), 100);
      const results = [...scope].sort(byMarketCapDesc).slice(0, lim).map(briefRef);

      return jsonResult({
        data: {
          scope: {
            segment: segment ?? null,
            country: country ?? null,
            market_position: market_position ?? null,
          },
          results,
          total: scope.length,
          returned: results.length,
          coverage: pricedCoverage(scope),
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- resolve_ticker -----------------------------------------------------
  server.registerTool(
    "resolve_ticker",
    {
      title: "Resolve ticker",
      description:
        "Batch-resolve up to 25 strings — tickers, company names, or ids, in any mix — to canonical company refs. " +
        "Call this FIRST whenever you have raw user input (a ticker list, pasted names) and need valid ids before " +
        "calling other tools; unresolved entries come back with up to 3 suggested close matches instead of just null.",
      inputSchema: {
        queries: z
          .array(z.string())
          .min(1)
          .max(25)
          .describe("Up to 25 strings to resolve, e.g. ['NVDA', 'TSMC', 'asml']. Each may be a ticker, an exact/partial company name, or a company id."),
      },
    },
    async ({ queries }) => {
      await recordUsage(ctx.env, "resolve_ticker", ctx.isSelfTest());
      const companies = await getCompanies();
      const byId = new Map(companies.map((c) => [c.id, c]));

      const scoreCandidate = (c: Company, qLower: string): number => {
        let s = 0;
        if (c.name.toLowerCase().startsWith(qLower)) s += 3;
        if (c.id.toLowerCase().startsWith(qLower)) s += 2;
        if (c.ticker && c.ticker.toLowerCase().startsWith(qLower)) s += 2;
        if (c.name.toLowerCase().includes(qLower)) s += 1;
        return s;
      };

      const results = queries.map((raw) => {
        const q = raw.trim();
        const qLower = q.toLowerCase();

        let match: Company | undefined = byId.get(q);
        let match_method: string | null = match ? "exact_id" : null;

        if (!match) {
          match = companies.find((c) => c.id.toLowerCase() === qLower);
          if (match) match_method = "case_insensitive_id";
        }
        if (!match) {
          match = companies.find((c) => c.name.toLowerCase() === qLower);
          if (match) match_method = "case_insensitive_name";
        }
        if (!match) {
          match = companies.find((c) => c.ticker !== null && c.ticker.toLowerCase() === qLower);
          if (match) match_method = "case_insensitive_ticker";
        }
        if (!match) {
          const substringMatches = companies.filter((c) => c.name.toLowerCase().includes(qLower));
          if (substringMatches.length === 1) {
            match = substringMatches[0];
            match_method = "substring_name";
          }
        }

        if (match) {
          return { query: raw, matched: briefRef(match), match_method, suggestions: [] as ReturnType<typeof briefRef>[] };
        }

        const candidates = companies.filter(
          (c) => c.name.toLowerCase().includes(qLower) || c.id.toLowerCase().includes(qLower) || (c.ticker !== null && c.ticker.toLowerCase().includes(qLower)),
        );
        const suggestions = candidates
          .slice()
          .sort((a, b) => scoreCandidate(b, qLower) - scoreCandidate(a, qLower) || a.name.length - b.name.length)
          .slice(0, 3)
          .map(briefRef);

        return { query: raw, matched: null, match_method: null, suggestions };
      });

      const matchedCount = results.filter((r) => r.matched !== null).length;

      return jsonResult({
        data: {
          results,
          total: results.length,
          returned: results.length,
          matched_count: matchedCount,
          unmatched_count: results.length - matchedCount,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );
};
