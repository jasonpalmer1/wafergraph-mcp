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
  /** When set, serve this entry without re-fetching until this timestamp (ms). */
  retryAfter?: number;
}

let companiesCache: CacheEntry<Company[]> | null = null;
let dealsCache: CacheEntry<Deal[]> | null = null;
// In-flight coalescing: concurrent callers past TTL share one fetch instead of
// stampeding the origin. Cleared when the fetch settles (success or failure).
let companiesInflight: Promise<Company[]> | null = null;
let dealsInflight: Promise<Deal[]> | null = null;

/** After a failed refresh, wait this long before trying origin again. */
const STALE_RETRY_BACKOFF_MS = 5 * 60 * 1000;

function isFresh<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
  if (entry === null) return false;
  if (entry.retryAfter && Date.now() < entry.retryAfter) return true;
  return Date.now() - entry.fetchedAt < TTL_MS;
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

async function loadCached<T>(
  filename: string,
  getCache: () => CacheEntry<T> | null,
  setCache: (entry: CacheEntry<T>) => void,
  getInflight: () => Promise<T> | null,
  setInflight: (p: Promise<T> | null) => void,
): Promise<T> {
  const cached = getCache();
  if (isFresh(cached)) return cached.data;

  const existing = getInflight();
  if (existing) return existing;

  const promise = (async () => {
    try {
      const data = await fetchJSON<T>(filename);
      setCache({ data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      // Prefer stale-but-present data over taking every tool down on a
      // transient upstream/edge failure. Only throw when we have nothing.
      // Bump retryAfter so we don't stampede origin on every subsequent call
      // while the TTL remains expired.
      const stale = getCache();
      if (stale) {
        setCache({ ...stale, retryAfter: Date.now() + STALE_RETRY_BACKOFF_MS });
        return stale.data;
      }
      throw err;
    } finally {
      setInflight(null);
    }
  })();

  setInflight(promise);
  return promise;
}

export async function getCompanies(): Promise<Company[]> {
  return loadCached(
    "companies.json",
    () => companiesCache,
    (e) => {
      companiesCache = e;
    },
    () => companiesInflight,
    (p) => {
      companiesInflight = p;
    },
  );
}

export async function getDeals(): Promise<Deal[]> {
  return loadCached(
    "deals.json",
    () => dealsCache,
    (e) => {
      dealsCache = e;
    },
    () => dealsInflight,
    (p) => {
      dealsInflight = p;
    },
  );
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
