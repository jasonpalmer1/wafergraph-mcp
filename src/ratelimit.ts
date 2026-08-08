// OPTIONAL public rate-limit helper — scaffold only.
//
// Not wired into src/index.ts yet. Enable later with an env flag if abuse
// appears on expensive graph tools. Design rules:
//   - Fail-open: KV errors must never block a tool call
//   - Counts only (same philosophy as usage.ts) — no query contents
//   - If you ever key by client IP, hash it with a secret salt first; never
//     store raw IPs in USAGE_KV
//
// Claude: see docs/FEATURE_SCAFFOLD.md §A2 before wiring this up.

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  limit: number;
}

const DEFAULT_LIMIT = 120; // requests per window per key
const WINDOW_SECONDS = 60 * 60; // 1 hour

function windowId(now = Date.now()): string {
  const d = new Date(now);
  return `${d.toISOString().slice(0, 13)}`; // YYYY-MM-DDTHH
}

/**
 * Best-effort fixed-window counter in USAGE_KV.
 * `key` should already be non-PII (e.g. `session:<id>` or `ip:<hmac>`).
 */
export async function checkRateLimit(
  env: Env,
  key: string,
  limit = DEFAULT_LIMIT,
): Promise<RateLimitResult> {
  try {
    const kvKey = `rl:${windowId()}:${key}`;
    const current = parseInt((await env.USAGE_KV.get(kvKey)) ?? "0", 10) || 0;
    if (current >= limit) return { ok: false, remaining: 0, limit };
    await env.USAGE_KV.put(kvKey, String(current + 1), { expirationTtl: WINDOW_SECONDS * 2 });
    return { ok: true, remaining: Math.max(limit - current - 1, 0), limit };
  } catch {
    return { ok: true, remaining: limit, limit }; // fail-open
  }
}
