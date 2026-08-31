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

// wafergraph.com gated companies.json/deals.json behind a Referer-or-token
// check 2026-08-31 (a plain anonymous curl used to return the full dataset —
// see that repo's functions/_lib/dataAccess.js for the full incident). This
// is a server-to-server fetch with no page context, so it goes through the
// token door: WAFERGRAPH_DATA_TOKEN must be set via `wrangler secret put
// WAFERGRAPH_DATA_TOKEN` and match one of the values in wafergraph's
// DATA_ACCESS_TOKENS Pages secret. Never hardcode the token here — this repo
// is public. Missing/wrong token degrades to whatever dataAccess.js does for
// an unauthorized request (403 JSON), which fetchJSON below surfaces as a
// normal upstream-fetch failure (same stale-cache fallback as any other
// outage — see getCompanies/getDeals).
//
// Set once per Durable Object session (WafergraphMCP.init() calls
// setDataAccessToken(this.env.WAFERGRAPH_DATA_TOKEN) as its first line) so
// none of the ~30 getCompanies()/getDeals() call sites across mcp-agent.ts
// and src/tools/*.ts need to thread env through — same "cache it once,
// module-scoped" shape this file already uses for companiesCache/dealsCache.
let dataAccessToken: string | undefined;
export function setDataAccessToken(token: string | undefined) {
  dataAccessToken = token;
}

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

// Set to true whenever a request is served from a TTL-expired in-memory
// cache because the live refetch failed (upstream down/network error/bad
// payload). Cleared back to false the next time a live fetch succeeds.
// Surfaced via dataFreshness() (see get_dataset_stats) so a degraded-but-
// still-answering server is visible to callers instead of silently
// pretending the data is current.
let companiesStale = false;
let dealsStale = false;

function isFresh<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
  return entry !== null && Date.now() - entry.fetchedAt < TTL_MS;
}

async function fetchJSON<T>(filename: string): Promise<T> {
  const res = await fetch(`${SOURCE_BASE}/${filename}`, {
    headers: dataAccessToken ? { Authorization: `Bearer ${dataAccessToken}` } : undefined,
    cf: {
      // Only cache genuine 200 JSON responses at the edge. Blindly caching
      // "everything" (the previous cacheEverything:true) would also cache a
      // transient 5xx/redirect from upstream for the full TTL, turning one
      // bad response into hours of bad responses for every isolate that hit
      // that PoP. Non-2xx responses get cacheTtl 0 (don't cache).
      cacheTtlByStatus: { "200-299": EDGE_CACHE_TTL_SECONDS, "300-599": 0 },
    },
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
  // Parse (and let a malformed body throw) before this response is trusted
  // enough to become the new in-memory cache entry.
  return (await res.json()) as T;
}

export async function getCompanies(): Promise<Company[]> {
  if (isFresh(companiesCache)) return companiesCache.data;
  try {
    const data = await fetchJSON<Company[]>("companies.json");
    companiesCache = { data, fetchedAt: Date.now() };
    companiesStale = false;
    return data;
  } catch (err) {
    // TTL expired (or no cache yet) and the live refetch failed. Prefer a
    // known-stale answer over a hard failure when we have one to give.
    if (companiesCache) {
      companiesStale = true;
      console.error(`getCompanies: live refetch failed, serving stale cache (age ${Date.now() - companiesCache.fetchedAt}ms):`, err);
      return companiesCache.data;
    }
    throw err;
  }
}

export async function getDeals(): Promise<Deal[]> {
  if (isFresh(dealsCache)) return dealsCache.data;
  try {
    const data = await fetchJSON<Deal[]>("deals.json");
    dealsCache = { data, fetchedAt: Date.now() };
    dealsStale = false;
    return data;
  } catch (err) {
    if (dealsCache) {
      dealsStale = true;
      console.error(`getDeals: live refetch failed, serving stale cache (age ${Date.now() - dealsCache.fetchedAt}ms):`, err);
      return dealsCache.data;
    }
    throw err;
  }
}

// Live cache-health snapshot: whether the last-served companies/deals came
// from a TTL-expired cache kept alive by a failed refetch (see getCompanies/
// getDeals above), plus the age of the oldest cached dataset. Read this
// rather than assuming a 200 response means fresh upstream data.
export function dataFreshness(): { companies_stale: boolean; deals_stale: boolean; cache_age_ms: number | null } {
  return { companies_stale: companiesStale, deals_stale: dealsStale, cache_age_ms: cacheAgeMs() };
}

// Best-effort live company count for descriptions/landing copy that used to
// hardcode a point-in-time number (565) which silently goes stale as the
// upstream dataset grows. Falls back to a conservative "600+" label if a
// live count truly can't be had (no cache yet and the fetch also failed),
// so a description never blocks tool registration or a landing-page render.
export async function getCompanyCountLabel(): Promise<string> {
  try {
    const companies = await getCompanies();
    return String(companies.length);
  } catch {
    return "600+";
  }
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
