// Deal-focused tools over wafergraph's 74-deal M&A corpus. Follows the same
// pattern as the original 9 tools in mcp-agent.ts (see shared.ts), lifted
// into its own module so mcp-agent.ts can register it via a single
// `registerDealTools(server, ctx)` call.
//
// Two data-integrity rules baked in throughout this file, both from the
// brief that spawned it:
//
//   1. A deal party's `id` is frequently null for targets that are not
//      themselves companies in the dataset (e.g. AMD's acquisition of Xilinx
//      has acquirer id "amd" but target id null, name "Xilinx"). Every
//      company-to-deal match here therefore tries id first, then falls back
//      to case-insensitive name matching — and never silently drops a
//      null-id party.
//   2. `confidence` is a per-deal quality flag on the record itself. It is
//      surfaced as-is; nothing here averages it into a derived score.
import { z } from "zod";
import { getCompanies, getDeals, getTaxonomy, DATA_SOURCE_MODE, TAXONOMY_SNAPSHOT_DATE } from "../data";
import { buildGraph, findCompany, type Graph } from "../graph";
import type { Company, Deal, DealParty } from "../types";
import { attributionGeneric, LINKS } from "../attribution";
import { recordUsage } from "../usage";
import { jsonResult, errorResult, companyRef, briefRef, tallyBy, type ToolRegistrar } from "./shared";

// ---- shared helpers --------------------------------------------------

// Resolve one deal party to a dataset company: id match first, then
// case-insensitive exact name match. Returns the match method so callers can
// tell a strong (id) match from a weaker (name-only) one.
function resolvePartyCompany(
  companies: Company[],
  graph: Graph,
  party: DealParty,
): { company: Company | null; method: "id" | "name" | null } {
  if (party.id) {
    const byId = graph.byId.get(party.id);
    if (byId) return { company: byId, method: "id" };
  }
  const needle = party.name.trim().toLowerCase();
  const byName = companies.find((c) => c.name.trim().toLowerCase() === needle);
  if (byName) return { company: byName, method: "name" };
  return { company: null, method: null };
}

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return true; // numbers, booleans, objects
}

interface FieldCoverage {
  field: string;
  filled: number;
  total: number;
  coverage_pct: number;
}

// Live-computed non-empty coverage per field — never hardcoded, so this
// cannot drift out of sync as the underlying dataset grows or backfills.
function coverage<T>(items: T[], fields: Array<[string, (item: T) => unknown]>): FieldCoverage[] {
  return fields.map(([field, get]) => {
    const filled = items.filter((item) => nonEmpty(get(item))).length;
    return {
      field,
      filled,
      total: items.length,
      coverage_pct: items.length ? Number(((filled / items.length) * 100).toFixed(1)) : 0,
    };
  });
}

interface DealRoleRow {
  id: string;
  title: string;
  type: string;
  value_usd: number | null;
  announced: string;
  status: string;
  role: string;
  match_method: "id" | "name";
  confidence: string;
}

export const registerDealTools: ToolRegistrar = (server, ctx) => {
  // ---- 1. get_deal -----------------------------------------------------
  server.registerTool(
    "get_deal",
    {
      title: "Get M&A deal",
      description:
        "Full record for one M&A deal by id: title, type, value, announced date, status, all parties with their " +
        "resolved company refs where a dataset id exists (and the raw party name where it does not), summary, " +
        "sources, and the per-deal confidence flag. Use get_deals or find_deals_by_company to find a deal id first.",
      inputSchema: {
        id: z.string().describe("Deal id as returned by get_deals/find_deals_by_company, e.g. 'amd_xilinx_2020'."),
      },
    },
    async ({ id }) => {
      await recordUsage(ctx.env, "get_deal", ctx.isSelfTest());
      const [deals, companies] = await Promise.all([getDeals(), getCompanies()]);
      const graph = buildGraph(companies);

      const needle = id.trim().toLowerCase();
      const deal = deals.find((d) => d.id === id) ?? deals.find((d) => d.id.toLowerCase() === needle);
      if (!deal) {
        const suggestions = deals
          .filter((d) => d.id.toLowerCase().includes(needle) || d.title.toLowerCase().includes(needle))
          .slice(0, 5)
          .map((d) => ({ id: d.id, title: d.title }));
        return errorResult(`No deal found for id "${id}".`, {
          hint: "Use get_deals to search by title/summary substring, or find_deals_by_company to look up by company.",
          suggestions,
        });
      }

      const parties = deal.parties.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        // Only resolved when the party record itself carries an id — no name
        // fallback here, per the get_deal contract (find_deals_by_company is
        // where the name-fallback matching lives).
        ...(p.id ? { company: companyRef(graph, p.id) } : {}),
      }));

      return jsonResult({
        data: {
          id: deal.id,
          title: deal.title,
          type: deal.type,
          value_usd: deal.value_usd,
          announced: deal.announced,
          status: deal.status,
          parties,
          summary: deal.summary,
          sources: deal.sources,
          confidence: deal.confidence,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 2. find_deals_by_company -----------------------------------------
  server.registerTool(
    "find_deals_by_company",
    {
      title: "Find deals by company",
      description:
        "Every M&A deal a company took part in, split by role (as acquirer, as target, or other). Matches by " +
        "dataset id first, then falls back to case-insensitive name matching — necessary because a deal's target is " +
        "frequently not itself a company in this dataset and carries a null id (e.g. AMD's acquisition of Xilinx " +
        "lists acquirer id 'amd' but target id null, name 'Xilinx'). Each matched deal carries a match_method " +
        "('id' or 'name') so weaker name-only matches are visible to the caller.",
      inputSchema: {
        company: z.string().describe("Company id, exact name, or ticker to search for across all deal parties, e.g. 'amd', 'Xilinx', 'AMD'."),
      },
    },
    async ({ company }) => {
      await recordUsage(ctx.env, "find_deals_by_company", ctx.isSelfTest());
      const [companies, deals] = await Promise.all([getCompanies(), getDeals()]);
      const graph = buildGraph(companies);

      const byTicker = new Map<string, Company>();
      for (const c of companies) if (c.ticker) byTicker.set(c.ticker.toUpperCase(), c);
      const resolved = findCompany(graph, company) ?? byTicker.get(company.trim().toUpperCase()) ?? null;
      const targetId = resolved?.id ?? null;
      const targetName = (resolved?.name ?? company).trim().toLowerCase();

      const asAcquirer: DealRoleRow[] = [];
      const asTarget: DealRoleRow[] = [];
      const other: DealRoleRow[] = [];

      for (const deal of deals) {
        for (const party of deal.parties) {
          let method: "id" | "name" | null = null;
          if (targetId && party.id === targetId) method = "id";
          else if (party.name.trim().toLowerCase() === targetName) method = "name";
          if (!method) continue;

          const row: DealRoleRow = {
            id: deal.id,
            title: deal.title,
            type: deal.type,
            value_usd: deal.value_usd,
            announced: deal.announced,
            status: deal.status,
            role: party.role,
            match_method: method,
            confidence: deal.confidence,
          };
          const roleLower = party.role.toLowerCase();
          if (roleLower.includes("acqu")) asAcquirer.push(row);
          else if (roleLower.includes("target")) asTarget.push(row);
          else other.push(row);
          break; // one matched party per deal is enough to place it
        }
      }

      const totalMatches = asAcquirer.length + asTarget.length + other.length;
      if (totalMatches === 0) {
        const needle = company.trim().toLowerCase();
        const suggestions = companies
          .filter((c) => c.name.toLowerCase().includes(needle) || c.id.toLowerCase().includes(needle))
          .slice(0, 5)
          .map((c) => ({ id: c.id, name: c.name }));
        return errorResult(`No deals found for company "${company}".`, {
          resolved_company: resolved ? briefRef(resolved) : null,
          hint: "Use search_companies to find a valid id/name, or get_deals to browse the full M&A corpus.",
          suggestions,
        });
      }

      const CAP = 25;
      const as_acquirer = asAcquirer.slice(0, CAP);
      const as_target = asTarget.slice(0, CAP);
      const otherCapped = other.slice(0, CAP);
      const returned = as_acquirer.length + as_target.length + otherCapped.length;

      return jsonResult({
        data: {
          query: company,
          resolved_company: resolved ? briefRef(resolved) : null,
          as_acquirer,
          as_target,
          other: otherCapped,
          total: totalMatches,
          returned,
          note: "match_method 'name' means the deal party had no dataset id and was matched by case-insensitive name only — treat it as a weaker match than 'id'.",
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 3. get_ma_activity_summary ---------------------------------------
  server.registerTool(
    "get_ma_activity_summary",
    {
      title: "Get M&A activity summary",
      description:
        "Aggregate view of the full 74-deal M&A corpus: counts by year (from announced date), by deal type, and by " +
        "status; total and median disclosed value; and the largest deals by value. Value figures are computed only " +
        "over the subset of deals with a disclosed value_usd and are never extrapolated to cover the undisclosed ones.",
      inputSchema: {
        top_n: z.number().int().min(1).max(25).optional().default(10).describe("How many largest-by-value deals to return, 1-25 (default 10)."),
      },
    },
    async ({ top_n }) => {
      await recordUsage(ctx.env, "get_ma_activity_summary", ctx.isSelfTest());
      const deals = await getDeals();

      const by_year = tallyBy(deals, (d) => (d.announced ? d.announced.slice(0, 4) : "unknown"));
      const by_type = tallyBy(deals, (d) => d.type);
      const by_status = tallyBy(deals, (d) => d.status);

      const valued = deals.filter((d): d is Deal & { value_usd: number } => typeof d.value_usd === "number");
      const total_usd = Number(valued.reduce((sum, d) => sum + d.value_usd, 0).toFixed(2));
      const sortedVals = valued.map((d) => d.value_usd).sort((a, b) => a - b);
      const median_usd = sortedVals.length
        ? sortedVals.length % 2 === 1
          ? sortedVals[(sortedVals.length - 1) / 2]
          : Number(((sortedVals[sortedVals.length / 2 - 1] + sortedVals[sortedVals.length / 2]) / 2).toFixed(2))
        : null;

      const cap = top_n ?? 10;
      const largest = valued
        .slice()
        .sort((a, b) => b.value_usd - a.value_usd)
        .slice(0, cap)
        .map((d) => ({ id: d.id, title: d.title, type: d.type, value_usd: d.value_usd, announced: d.announced, status: d.status }));

      return jsonResult({
        data: {
          total_deals: deals.length,
          by_year,
          by_type,
          by_status,
          disclosed_value: {
            deals_with_value: valued.length,
            deals_total: deals.length,
            coverage: `${valued.length}/${deals.length}`,
            total_usd,
            median_usd,
          },
          largest_deals: { results: largest, total: valued.length, returned: largest.length },
          methodology:
            "by_year/by_type/by_status count all deals in the corpus. total_usd, median_usd, and largest_deals are " +
            "computed only over deals that carry a disclosed value_usd; deals without one are excluded from those " +
            "figures, never imputed or estimated.",
          caveat: `Only ${valued.length} of ${deals.length} deals have a disclosed value_usd. total_usd/median_usd/largest_deals reflect just that subset — the other ${deals.length - valued.length} deals happened but their size is unknown and is not guessed at here.`,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 4. find_consolidation_hotspots ------------------------------------
  server.registerTool(
    "find_consolidation_hotspots",
    {
      title: "Find consolidation hotspots",
      description:
        "Ranks taxonomy segments by M&A activity by mapping each deal's parties onto their companies' segments " +
        "(matching by id, then falling back to case-insensitive name), then aggregating deal count and disclosed " +
        "value per segment. Deals whose parties cannot be resolved to any dataset company are counted in " +
        "unmapped_deals rather than dropped, so thinly-covered segments aren't silently underrepresented.",
      inputSchema: {
        limit: z.number().int().min(1).max(12).optional().default(12).describe("How many ranked segments to return, 1-12 (there are 12 segments total)."),
        sort_by: z
          .enum(["deal_count", "value"])
          .optional()
          .default("deal_count")
          .describe("Rank segments by number of deals ('deal_count') or by summed disclosed deal value ('value')."),
      },
    },
    async ({ limit, sort_by }) => {
      await recordUsage(ctx.env, "find_consolidation_hotspots", ctx.isSelfTest());
      const [companies, deals, taxonomy] = await Promise.all([getCompanies(), getDeals(), getTaxonomy()]);
      const graph = buildGraph(companies);
      const segNames = new Map(taxonomy.segments.map((s) => [s.id, s.name]));

      const segStats = new Map<string, { deal_count: number; disclosed_value_usd: number; deals_with_value: number }>();
      let unmapped_deals = 0;

      for (const deal of deals) {
        const touchedSegments = new Set<string>();
        for (const party of deal.parties) {
          const { company } = resolvePartyCompany(companies, graph, party);
          if (!company) continue;
          for (const s of company.segments) touchedSegments.add(s.segment);
        }
        if (touchedSegments.size === 0) {
          unmapped_deals++;
          continue;
        }
        for (const segId of touchedSegments) {
          const cur = segStats.get(segId) ?? { deal_count: 0, disclosed_value_usd: 0, deals_with_value: 0 };
          cur.deal_count += 1;
          if (typeof deal.value_usd === "number") {
            cur.disclosed_value_usd += deal.value_usd;
            cur.deals_with_value += 1;
          }
          segStats.set(segId, cur);
        }
      }

      const hotspots = [...segStats.entries()].map(([segId, stats]) => ({
        segment: segId,
        segment_name: segNames.get(segId) ?? segId,
        deal_count: stats.deal_count,
        disclosed_value_usd: Number(stats.disclosed_value_usd.toFixed(2)),
        deals_with_value: stats.deals_with_value,
      }));

      hotspots.sort((a, b) => (sort_by === "value" ? b.disclosed_value_usd - a.disclosed_value_usd : b.deal_count - a.deal_count));

      const cap = limit ?? 12;
      const results = hotspots.slice(0, cap);

      return jsonResult({
        data: {
          results,
          total_segments_touched: hotspots.length,
          returned: results.length,
          unmapped_deals,
          total_deals: deals.length,
          methodology:
            "Each deal is attributed to every taxonomy segment reached by any of its resolvable parties (deduped " +
            "per deal, so two same-segment parties on one deal count once there). A deal touching two different " +
            "segments is counted, and its value summed, into both — so deal_count and disclosed_value_usd across " +
            "all segments can exceed total_deals / total disclosed value; do not sum segment totals into one grand total.",
          caveat: `${unmapped_deals} of ${deals.length} deals could not be mapped to any segment because none of their parties resolved to a company in the dataset (by id or by case-insensitive name). They are counted in unmapped_deals, not silently dropped.`,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );

  // ---- 5. get_dataset_stats ----------------------------------------------
  server.registerTool(
    "get_dataset_stats",
    {
      title: "Get dataset stats",
      description:
        "The honesty tool: what this dataset actually contains and where it is thin. Live-computed per-field " +
        "coverage for companies and deals, last_verified staleness distribution, supply-chain edge coverage, data " +
        "source mode, and a plain-words list of known limitations. Call this before treating an absence of a " +
        "company, deal, or edge as evidence it doesn't exist in the real market.",
      inputSchema: {},
    },
    async () => {
      await recordUsage(ctx.env, "get_dataset_stats", ctx.isSelfTest());
      const [companies, deals, taxonomy] = await Promise.all([getCompanies(), getDeals(), getTaxonomy()]);
      const graph = buildGraph(companies);
      const countries = new Set(companies.map((c) => c.country)).size;

      const company_field_coverage = coverage<Company>(companies, [
        ["ticker", (c) => c.ticker],
        ["exchange", (c) => c.exchange],
        ["market_cap_usd_b", (c) => c.market_cap_usd_b],
        ["market_cap_updated", (c) => c.market_cap_updated],
        ["key_customers", (c) => c.key_customers],
        ["key_suppliers", (c) => c.key_suppliers],
        ["key_products", (c) => c.key_products],
        ["sources", (c) => c.sources],
        ["segments", (c) => c.segments],
        ["one_liner", (c) => c.one_liner],
        ["last_verified", (c) => c.last_verified],
        ["country", (c) => c.country],
        ["name", (c) => c.name],
      ]);

      const deal_field_coverage = coverage<Deal>(deals, [
        ["id", (d) => d.id],
        ["title", (d) => d.title],
        ["type", (d) => d.type],
        ["value_usd", (d) => d.value_usd],
        ["announced", (d) => d.announced],
        ["status", (d) => d.status],
        ["parties", (d) => d.parties],
        ["summary", (d) => d.summary],
        ["sources", (d) => d.sources],
        ["confidence", (d) => d.confidence],
        ["reaction", (d) => d.reaction],
      ]);

      // last_verified staleness distribution — ISO date strings sort lexically.
      const lvDates = companies.map((c) => c.last_verified).filter((d): d is string => !!d).slice().sort();
      const oldest = lvDates[0] ?? null;
      const newest = lvDates[lvDates.length - 1] ?? null;
      let median: string | null = null;
      if (lvDates.length) {
        const mid = lvDates.length / 2;
        const medianMs =
          lvDates.length % 2 === 1
            ? new Date(lvDates[Math.floor(mid)]).getTime()
            : (new Date(lvDates[mid - 1]).getTime() + new Date(lvDates[mid]).getTime()) / 2;
        median = new Date(medianMs).toISOString().slice(0, 10);
      }
      let older_than_90d_vs_newest_count = 0;
      if (newest) {
        const cutoffMs = new Date(newest).getTime() - 90 * 24 * 60 * 60 * 1000;
        older_than_90d_vs_newest_count = lvDates.filter((d) => new Date(d).getTime() < cutoffMs).length;
      }

      // Supply-chain edge counts/coverage.
      let edge_count = 0;
      for (const set of graph.customers.values()) edge_count += set.size;
      const companiesWithEdges = new Set<string>();
      for (const [id, set] of graph.suppliers) if (set.size > 0) companiesWithEdges.add(id);
      for (const [id, set] of graph.customers) if (set.size > 0) companiesWithEdges.add(id);
      const edge_coverage_pct = companies.length ? Number(((companiesWithEdges.size / companies.length) * 100).toFixed(1)) : 0;

      const findField = (table: FieldCoverage[], field: string) => table.find((f) => f.field === field);
      const marketCapCov = findField(company_field_coverage, "market_cap_usd_b");
      const supplierCov = findField(company_field_coverage, "key_suppliers");
      const dealValueCov = findField(deal_field_coverage, "value_usd");

      const known_limitations = [
        "Curated, not exhaustive: this dataset covers the companies and deals wafergraph.com has researched and verified — the absence of a company or deal here is not evidence it doesn't exist in the real market.",
        "Headquarters country is not fab/manufacturing location: a company's `country` field is where it is headquartered, not where its fabs or plants physically sit.",
        `Supplier edges are incomplete: key_suppliers is filled on only ${supplierCov ? supplierCov.coverage_pct : "an unknown"}% of companies (${supplierCov ? `${supplierCov.filled}/${supplierCov.total}` : "n/a"}), so supply-chain/chokepoint tools understate real dependency, especially in less-covered segments.`,
        `Market caps are partial: market_cap_usd_b is missing on ${marketCapCov ? (100 - marketCapCov.coverage_pct).toFixed(1) : "an unknown"}% of companies — any market-cap sum or ranking anywhere in this server covers only the priced subset, never the whole dataset.`,
        `Deal values are partially disclosed: value_usd is present on only ${dealValueCov ? `${dealValueCov.filled}/${dealValueCov.total}` : "an unknown fraction of"} deals — aggregate value figures exclude the rest rather than estimate them.`,
        "The `reaction` field on deals exists in the schema but is effectively empty across the corpus and should not be relied on.",
        "This tool describes the shape and gaps of what is in the dataset — it cannot tell you about companies, deals, or edges that are missing from it entirely.",
      ];

      return jsonResult({
        data: {
          counts: {
            companies: companies.length,
            deals: deals.length,
            segments: taxonomy.segments.length,
            countries,
          },
          company_field_coverage,
          deal_field_coverage,
          last_verified: {
            oldest,
            newest,
            median,
            older_than_90d_vs_newest_count,
            older_than_90d_vs_newest_of: lvDates.length,
            note: "'Older than 90 days' is measured against the newest last_verified date in this dataset, not wall-clock today — this describes internal staleness spread, not absolute age.",
          },
          supply_chain_edges: {
            edge_count,
            companies_with_at_least_one_edge: companiesWithEdges.size,
            total_companies: companies.length,
            edge_coverage_pct,
          },
          data_source_mode: DATA_SOURCE_MODE,
          taxonomy_snapshot_date: TAXONOMY_SNAPSHOT_DATE,
          known_limitations,
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );
};
