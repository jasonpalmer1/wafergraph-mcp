// Worker entry point. Two routes:
//   GET|HEAD /   -> human landing page (what this is, install snippets)
//   /mcp, /mcp/* -> the MCP server (Streamable HTTP transport)
// Everything else is a 404.
//
// Optional RATE_LIMIT_ENABLED=1 (Worker var/secret) applies a coarse
// fail-open KV rate limit on /mcp. Off by default — public dataset v1.
import { WafergraphMCP } from "./mcp-agent";
import { renderLanding } from "./landing";
import { checkRateLimit } from "./ratelimit";

// Re-export so wrangler.jsonc's durable_objects binding (class_name:
// "WafergraphMCP") can resolve it from this Worker's main module.
export { WafergraphMCP };

type EnvWithFlag = Env & { RATE_LIMIT_ENABLED?: string };

function rateLimitKey(request: Request): string {
  // Prefer MCP session continuity; else a coarse CF colo bucket (not an IP —
  // we deliberately avoid storing client IPs in USAGE_KV).
  const sid = request.headers.get("mcp-session-id");
  if (sid) return `session:${sid.slice(0, 64)}`;
  const colo = request.cf && typeof request.cf === "object" && "colo" in request.cf
    ? String((request.cf as { colo?: string }).colo ?? "xx")
    : "xx";
  return `colo:${colo}`;
}

export default {
  async fetch(request: Request, env: EnvWithFlag, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(request.method === "HEAD" ? null : renderLanding(url.origin), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      if (env.RATE_LIMIT_ENABLED === "1" || env.RATE_LIMIT_ENABLED === "true") {
        const rl = await checkRateLimit(env, rateLimitKey(request));
        if (!rl.ok) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Rate limit exceeded. Retry later." },
              id: null,
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "retry-after": "3600",
                "x-ratelimit-limit": String(rl.limit),
                "x-ratelimit-remaining": "0",
              },
            },
          );
        }
      }
      return WafergraphMCP.serve("/mcp", { binding: "WAFERGRAPH_MCP" }).fetch(request, env, ctx);
    }

    // Lightweight health for uptime monitors (no DO / no data fetch).
    if (url.pathname === "/health" && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(request.method === "HEAD" ? null : JSON.stringify({ ok: true, service: "wafergraph-mcp" }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
