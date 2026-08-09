// Worker entry point. Two routes:
//   GET /        -> human landing page (what this is, install snippets)
//   /mcp, /mcp/* -> the MCP server (Streamable HTTP transport)
// Everything else is a 404.
import { WafergraphMCP } from "./mcp-agent";
import { renderLanding } from "./landing";
import { getCompanyCountLabel } from "./data";

// Re-export so wrangler.jsonc's durable_objects binding (class_name:
// "WafergraphMCP") can resolve it from this Worker's main module.
export { WafergraphMCP };

// ---- basic per-IP rate limiting for /mcp -----------------------------
//
// This is a dependency-free floor, not a substitute for edge-level
// protection: it's a sliding window kept in a module-scoped Map, so it only
// guards the ONE isolate currently handling requests. It resets on cold
// start, does not coordinate across Cloudflare's many PoPs/isolates, and a
// distributed attacker can trivially spread requests across isolates to
// evade it. For real abuse/DDoS protection in front of this Worker, use
// Cloudflare's WAF / Rate Limiting Rules (dashboard or Terraform) — this is
// meant to blunt a single noisy client hammering one isolate, nothing more.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60; // ~60 req/min per IP
// Defensive cap on how many distinct IPs this isolate tracks at once, so a
// wide (low-rate-per-IP) probe can't grow this Map without bound over the
// isolate's lifetime. Resetting everyone's window on overflow is a blunt
// but safe, dependency-free way to bound memory.
const RATE_LIMIT_MAX_TRACKED_IPS = 5000;

const requestTimestampsByIp = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (requestTimestampsByIp.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestTimestampsByIp.set(ip, recent);
    return true;
  }

  recent.push(now);
  requestTimestampsByIp.set(ip, recent);

  if (requestTimestampsByIp.size > RATE_LIMIT_MAX_TRACKED_IPS) requestTimestampsByIp.clear();

  return false;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      const companyCountLabel = await getCompanyCountLabel();
      return new Response(renderLanding(url.origin, companyCountLabel), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const ip = request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For") ?? "unknown";
      if (isRateLimited(ip)) {
        return new Response(
          JSON.stringify({ error: `Rate limit exceeded: max ${RATE_LIMIT_MAX_REQUESTS} requests/minute per IP. Try again shortly.` }),
          {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "60" },
          },
        );
      }
      return WafergraphMCP.serve("/mcp", { binding: "WAFERGRAPH_MCP" }).fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
