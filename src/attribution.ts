// Fixed attribution + links block, attached to every tool response. See
// ATTRIBUTION.md for the full licensing detail this summarizes.

export interface Attribution {
  compiled_by: string;
  sources: string[];
  note: string;
  company_url?: string;
}

const BASE_ATTRIBUTION: Omit<Attribution, "company_url"> = {
  compiled_by: "wafergraph.com",
  sources: [
    "SEC filings (public domain)",
    "Wikidata (CC0)",
    "Wikipedia (CC BY-SA 4.0 — attribution required, see ATTRIBUTION.md)",
    "GLEIF (legal entity data)",
  ],
  note: "Compiled by wafergraph.com from public sources; see company_url for the full sourced profile.",
};

export function companyUrl(id: string): string {
  return `https://wafergraph.com/company/${id}`;
}

// Attribution block for a response about exactly one focal company.
export function attributionForCompany(id: string): Attribution {
  return { ...BASE_ATTRIBUTION, company_url: companyUrl(id) };
}

// Attribution block for a response with no single focal company (lists,
// segments, deals). Per-item company_url is attached on individual rows
// instead — see each tool's mapping in mcp-agent.ts.
export function attributionGeneric(): Attribution {
  return { ...BASE_ATTRIBUTION };
}

export const LINKS = {
  report: "https://wafergraph.com/pro",
  newsletter: "https://wafergraph.com",
  note: "Deeper analysis: the $99 wafergraph report (wafergraph.com/pro).",
} as const;
