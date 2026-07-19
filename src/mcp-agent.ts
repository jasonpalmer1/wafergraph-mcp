// The MCP server itself: registers the 5 read-only tools over wafergraph's
// public dataset. Backed by a Durable Object per the `agents` package's
// McpAgent pattern (free on the Workers Free plan — SQLite storage backend,
// verified against current Cloudflare docs before building this). No
// per-session state is actually needed (every tool is a pure read over data
// fetched fresh by src/data.ts), so State is an empty object.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { getCompanies, getTaxonomy, getDeals, DATA_SOURCE_MODE, TAXONOMY_SNAPSHOT_DATE } from "./data";
import { buildGraph, findCompany, suppliersOf, customersOf, walkChain, type Graph } from "./graph";
import { toAllowedCompany } from "./types";
import { attributionForCompany, attributionGeneric, companyUrl, LINKS } from "./attribution";

type State = Record<string, never>;

function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function errorResult(message: string, extra?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message, ...extra }) }],
    isError: true,
  };
}

// Compact reference to another company for use in edge lists (suppliers/
// customers/chain tiers) — enough for an agent to act without a second call.
function companyRef(g: Graph, id: string) {
  const c = g.byId.get(id);
  if (!c) return { id, company_url: companyUrl(id) };
  return {
    id: c.id,
    name: c.name,
    ticker: c.ticker,
    market_position: c.market_position,
    market_cap_usd_b: c.market_cap_usd_b,
    company_url: companyUrl(c.id),
  };
}

export class WafergraphMCP extends McpAgent<Env, State, {}> {
  server = new McpServer({ name: "wafergraph-mcp", version: "1.0.0" });
  initialState: State = {};

  async init() {
    // ---- 1. search_companies -------------------------------------------
    this.server.registerTool(
      "search_companies",
      {
        title: "Search companies",
        description:
          "Search wafergraph's semiconductor & AI supply-chain company dataset (565 companies across 12 segments) by " +
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
        const companies = await getCompanies();
        const q = query?.trim().toLowerCase();
        const seg = segment?.trim().toLowerCase();
        const ctry = country?.trim().toLowerCase();

        const matches = companies.filter((c) => {
          if (q && !(c.name.toLowerCase().includes(q) || c.one_liner.toLowerCase().includes(q))) return false;
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
    this.server.registerTool(
      "get_company",
      {
        title: "Get company",
        description:
          "Full allowed profile for one company (by id or exact name) plus its supplier/customer supply-chain edges. " +
          "Includes key_products (short list of named products/lines). Fields are deliberately limited to " +
          "established/trust-checked data (see README field-discipline note).",
        inputSchema: {
          id: z.string().describe("Company id, snake_case (e.g. 'tsmc', 'asml') or exact company name."),
        },
      },
      async ({ id }) => {
        const companies = await getCompanies();
        const graph = buildGraph(companies);
        const company = findCompany(graph, id);
        if (!company) {
          return errorResult(`No company found for "${id}".`, {
            hint: "Use search_companies to find a valid id or name.",
          });
        }

        const suppliers = suppliersOf(graph, company.id).map((sid) => companyRef(graph, sid));
        const customers = customersOf(graph, company.id).map((cid) => companyRef(graph, cid));

        return jsonResult({
          data: { company: toAllowedCompany(company), suppliers, customers },
          attribution: attributionForCompany(company.id),
          links: LINKS,
        });
      },
    );

    // ---- 3. get_segments ---------------------------------------------
    this.server.registerTool(
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
        const [taxonomy, companies] = await Promise.all([getTaxonomy(), getCompanies()]);

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
    this.server.registerTool(
      "get_supply_chain",
      {
        title: "Get supply chain",
        description:
          "Walk the supplier/customer graph from one focal company, up to 2 tiers up (suppliers), down (customers), or both. " +
          "Mirrors the chain view on wafergraph.com's Explorer. Returns companies grouped by tier plus the edges between them.",
        inputSchema: {
          id: z.string().describe("Focal company id or name."),
          direction: z
            .enum(["up", "down", "both"])
            .default("both")
            .describe("up = walk suppliers only, down = walk customers only, both = walk both directions."),
          depth: z.number().int().min(0).max(2).default(2).describe("Number of tiers to walk, capped at 2."),
        },
      },
      async ({ id, direction, depth }) => {
        const companies = await getCompanies();
        const graph = buildGraph(companies);
        const focal = findCompany(graph, id);
        if (!focal) {
          return errorResult(`No company found for "${id}".`, {
            hint: "Use search_companies to find a valid id or name.",
          });
        }

        const chain = walkChain(graph, focal.id, direction, depth);

        return jsonResult({
          data: chain,
          attribution: attributionForCompany(focal.id),
          links: LINKS,
        });
      },
    );

    // ---- 5. get_deals -----------------------------------------------------
    this.server.registerTool(
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
        const [deals, companies] = await Promise.all([getDeals(), getCompanies()]);
        const byId = new Map(companies.map((c) => [c.id, c]));
        const q = query?.trim().toLowerCase();
        const seg = segment?.trim().toLowerCase();

        const matches = deals.filter((d) => {
          if (q && !(d.title.toLowerCase().includes(q) || d.summary.toLowerCase().includes(q))) return false;
          if (seg) {
            const inSegment = d.parties.some(
              (p) => p.id && byId.get(p.id)?.segments.some((s) => s.segment.toLowerCase() === seg),
            );
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
  }
}

export { DATA_SOURCE_MODE };
