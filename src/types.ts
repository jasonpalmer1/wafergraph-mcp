// Shape of the raw JSON records fetched from wafergraph.com/data/*.json.
// Mirrors data/schema.json in the wafergraph site repo (source of truth
// lives there — this is a read-only TypeScript view of the same shape).

export interface CompanySegment {
  segment: string;
  subsegment: string;
}

export interface Company {
  id: string;
  name: string;
  ticker: string | null;
  exchange: string | null;
  public: boolean;
  country: string;
  segments: CompanySegment[];
  one_liner: string;
  // key_products is present in the raw upstream data but deliberately NOT
  // exposed by this server — see field-discipline note in CLAUDE.md /
  // README.md. Re-enable a mapped field here once the verified deep-fill
  // lands upstream (tracked in wafergraph's own CLAUDE.md).
  key_products?: string[];
  key_customers: string[];
  key_suppliers: string[];
  market_position: "monopoly" | "leader" | "major" | "challenger" | "niche";
  market_cap_usd_b: number | null;
  market_cap_updated: string | null;
  last_verified: string;
  sources: string[];
}

export interface TaxonomySubsegment {
  id: string;
  name: string;
}

export interface TaxonomySegment {
  id: string;
  name: string;
  order: number;
  blurb: string;
  subsegments: TaxonomySubsegment[];
}

export interface Taxonomy {
  segments: TaxonomySegment[];
  market_positions: string[];
}

export interface DealParty {
  id: string | null;
  name: string;
  role: string;
}

export interface Deal {
  id: string;
  title: string;
  type: string;
  value_usd: number | null;
  announced: string;
  status: string;
  parties: DealParty[];
  summary: string;
  sources: string[];
  confidence: string;
  reaction: unknown;
}

// Fields allowed out of this server for a company record (trust/field
// discipline rule — see README.md "Field discipline"). key_products is
// intentionally absent.
export interface AllowedCompany {
  id: string;
  name: string;
  ticker: string | null;
  exchange: string | null;
  public: boolean;
  country: string;
  segments: CompanySegment[];
  one_liner: string;
  market_position: Company["market_position"];
  market_cap_usd_b: number | null;
  market_cap_updated: string | null;
  last_verified: string;
  sources: string[];
}

export function toAllowedCompany(c: Company): AllowedCompany {
  // Deliberately whitelist fields rather than blacklist — this is the one
  // place key_products (and anything added upstream later) gets dropped.
  return {
    id: c.id,
    name: c.name,
    ticker: c.ticker,
    exchange: c.exchange,
    public: c.public,
    country: c.country,
    segments: c.segments,
    one_liner: c.one_liner,
    market_position: c.market_position,
    market_cap_usd_b: c.market_cap_usd_b,
    market_cap_updated: c.market_cap_updated,
    last_verified: c.last_verified,
    sources: c.sources,
  };
}
