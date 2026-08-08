// Meta / routing tools — help agents pick the right wafergraph tool without
// stuffing every description into context. Keep this file tiny.
import { z } from "zod";
import { recordUsage } from "../usage";
import { jsonResult, type ToolRegistrar } from "./shared";
import { attributionGeneric, LINKS } from "../attribution";

/** Intent → recommended tool chain. Claude: extend rows as new tools ship. */
const ROUTING: Array<{
  intent: string;
  primary: string;
  also?: string[];
  notes?: string;
}> = [
  {
    intent: "I have tickers/names and need canonical ids",
    primary: "resolve_ticker",
    also: ["search_companies"],
  },
  {
    intent: "Full profile + edges for one company",
    primary: "get_company",
    notes: "Pass compact=true if context is tight.",
  },
  {
    intent: "How are two companies connected?",
    primary: "explain_relationship",
    also: ["find_paths_between", "compare_companies"],
  },
  {
    intent: "Screen / filter the universe",
    primary: "filter_companies",
    also: ["list_subsegments", "get_segments"],
  },
  {
    intent: "Who is a chokepoint / single source?",
    primary: "find_chokepoints",
    also: ["find_single_source_dependencies", "find_substitutes"],
  },
  {
    intent: "What else is in the same niche?",
    primary: "find_substitutes",
    also: ["find_similar_companies", "get_subsegment"],
  },
  {
    intent: "Portfolio / ticker list risk",
    primary: "analyze_portfolio_exposure",
    also: ["simulate_disruption"],
  },
  {
    intent: "M&A / consolidation",
    primary: "get_deals",
    also: ["find_deals_by_company", "find_consolidation_hotspots", "get_ma_activity_summary"],
  },
  {
    intent: "Geography / HQ concentration",
    primary: "list_countries",
    also: ["get_country_profile", "compare_countries", "get_country_exposure"],
    notes: "country = headquarters, not fab location.",
  },
  {
    intent: "Is the dataset thin / stale?",
    primary: "get_dataset_stats",
  },
];

export const registerMetaTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "recommend_tools",
    {
      title: "Recommend which tools to call",
      description:
        "Given a short natural-language intent about semiconductor supply-chain research, return the best primary " +
        "wafergraph MCP tool and optional follow-ups. Call this when unsure which of the 30+ tools to use — cheaper " +
        "than trial-and-error. Does not run the other tools; it only routes.",
      inputSchema: {
        intent: z
          .string()
          .min(3)
          .max(400)
          .describe("What you're trying to learn, e.g. 'shared suppliers of NVDA and AMD' or 'who could replace ASML'."),
      },
    },
    async ({ intent }) => {
      void recordUsage(ctx.env, "recommend_tools", ctx.isSelfTest());
      const q = intent.trim().toLowerCase();
      const scored = ROUTING.map((row) => {
        const hay = `${row.intent} ${row.primary} ${(row.also ?? []).join(" ")} ${(row.notes ?? "")}`.toLowerCase();
        let score = 0;
        for (const token of q.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)) {
          if (hay.includes(token)) score += 2;
          if (row.intent.toLowerCase().includes(token)) score += 3;
        }
        // Light synonym boosts
        if (/ticker|symbol|nvda|tsm/.test(q) && row.primary === "resolve_ticker") score += 5;
        if (/path|connect|between|depend/.test(q) && row.primary === "explain_relationship") score += 5;
        if (/choke|single.?source|bottleneck/.test(q) && row.primary === "find_chokepoints") score += 5;
        if (/substitut|alternativ|replace/.test(q) && row.primary === "find_substitutes") score += 5;
        if (/deal|m&a|acqui|merger|consolidat/.test(q) && row.primary === "get_deals") score += 5;
        if (/portfolio|holding|basket/.test(q) && row.primary === "analyze_portfolio_exposure") score += 5;
        if (/country|geo|taiwan|hq/.test(q) && row.primary === "list_countries") score += 4;
        if (/cover|stale|limit|gap|fresh/.test(q) && row.primary === "get_dataset_stats") score += 5;
        return { ...row, score };
      })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);

      const top = scored.slice(0, 3);
      return jsonResult({
        data: {
          intent,
          recommendations: top.length
            ? top.map(({ intent: matched_intent, primary, also, notes, score }) => ({
                matched_intent,
                primary,
                also: also ?? [],
                notes: notes ?? null,
                score,
              }))
            : [
                {
                  matched_intent: "fallback",
                  primary: "search_companies",
                  also: ["get_segments", "get_dataset_stats", "recommend_tools"],
                  notes: "No strong match — start with search_companies or get_segments.",
                  score: 0,
                },
              ],
          tip: "After resolve_ticker / search_companies, prefer explain_relationship over ad-hoc tool chains.",
        },
        attribution: attributionGeneric(),
        links: LINKS,
      });
    },
  );
};
