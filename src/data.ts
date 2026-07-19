// Data layer: HYBRID source mode, decided from real E2E verification (not
// assumption) — see CLAUDE.md "Session memory" for the full story.
//
//   - companies.json and deals.json ARE genuinely publicly fetchable: they
//     serve with `content-type: application/json`, `Access-Control-Allow-
//     Origin: *`, and upstream `Cache-Control: public, max-age=14400`.
//     Confirmed both by curl and by this server's own live tool calls.
//     -> LIVE-FETCH, cached in-isolate for ~6h.
//
//   - taxonomy.json returns HTTP 200 but with `content-type: text/html` —
//     it's the SPA's index.html shell, not the JSON file. The wafergraph
//     site bundles the taxonomy into its JS at build time and (unlike
//     companies/deals) never emits it as a standalone static asset — its
//     own CLAUDE.md says as much ("Small taxonomy files stay bundled").
//     Fetching it live would silently break get_segments (res.json() throws
//     on the HTML body) every single call.
//     -> VENDORED SNAPSHOT (data/taxonomy.snapshot.json, copied from
//        ~/projects/wafergraph/data/taxonomy.json). Re-sync with
//        scripts/refresh-data.sh. Snapshot date is surfaced on every
//        get_segments response so agents/consumers know its provenance.
//
// Two-layer cache for the live-fetched files:
//   1. In-isolate memory (this module's module-scoped variables) — free,
//      instant, survives for the life of the isolate.
//   2. `fetch(url, { cf: { cacheTtl } })` — Cloudflare edge cache for the
//      *subrequest* to wafergraph.com. Works regardless of whether this
//      Worker is on a workers.dev subdomain or a custom domain (unlike the
//      Cache API, which Cloudflare's docs only explicitly guarantee for
//      custom domains), so a cold isolate still gets a fast edge hit
//      instead of re-hitting the origin every time.
import type { Company, Taxonomy, Deal } from "./types";
import taxonomySnapshot from "../data/taxonomy.snapshot.json";

const SOURCE_BASE = "https://wafergraph.com/data";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h, matches the edge cacheTtl below
const EDGE_CACHE_TTL_SECONDS = 6 * 60 * 60;

export const DATA_SOURCE_MODE = "hybrid (companies.json + deals.json live-fetch; taxonomy.json vendored snapshot)" as const;

// Last-modified date of the wafergraph repo's data/taxonomy.json at the time
// it was copied into data/taxonomy.snapshot.json. Update when re-running
// scripts/refresh-data.sh against a newer upstream file.
export const TAXONOMY_SNAPSHOT_DATE = "2026-06-23";

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

let companiesCache: CacheEntry<Company[]> | null = null;
let dealsCache: CacheEntry<Deal[]> | null = null;

function isFresh<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
  return entry !== null && Date.now() - entry.fetchedAt < TTL_MS;
}

async function fetchJSON<T>(filename: string): Promise<T> {
  const res = await fetch(`${SOURCE_BASE}/${filename}`, {
    cf: { cacheTtl: EDGE_CACHE_TTL_SECONDS, cacheEverything: true },
  });
  if (!res.ok) {
    throw new Error(`wafergraph upstream fetch failed for ${filename}: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    // Guards against a repeat of the taxonomy.json discovery: if wafergraph
    // ever stops serving one of these as real JSON (e.g. falls back to the
    // SPA shell), fail loudly instead of returning HTML as "data".
    throw new Error(`wafergraph upstream returned non-JSON content-type "${contentType}" for ${filename}`);
  }
  return res.json();
}

export async function getCompanies(): Promise<Company[]> {
  if (isFresh(companiesCache)) return companiesCache.data;
  const data = await fetchJSON<Company[]>("companies.json");
  companiesCache = { data, fetchedAt: Date.now() };
  return data;
}

export async function getDeals(): Promise<Deal[]> {
  if (isFresh(dealsCache)) return dealsCache.data;
  const data = await fetchJSON<Deal[]>("deals.json");
  dealsCache = { data, fetchedAt: Date.now() };
  return data;
}

// Vendored snapshot — not fetched, no cache needed (bundled at deploy time).
export async function getTaxonomy(): Promise<Taxonomy> {
  return taxonomySnapshot as Taxonomy;
}

// Age (ms) of the oldest currently-cached LIVE dataset, for surfacing
// freshness. Returns null if nothing is cached yet. Doesn't cover taxonomy
// (see TAXONOMY_SNAPSHOT_DATE for that one's provenance instead).
export function cacheAgeMs(): number | null {
  const stamps = [companiesCache?.fetchedAt, dealsCache?.fetchedAt].filter(
    (v): v is number => typeof v === "number",
  );
  if (stamps.length === 0) return null;
  return Date.now() - Math.min(...stamps);
}
