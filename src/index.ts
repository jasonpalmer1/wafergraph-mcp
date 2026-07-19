// Worker entry point. Two routes:
//   GET /        -> human landing page (what this is, install snippets)
//   /mcp, /mcp/* -> the MCP server (Streamable HTTP transport)
// Everything else is a 404.
import { WafergraphMCP } from "./mcp-agent";
import { renderLanding } from "./landing";

// Re-export so wrangler.jsonc's durable_objects binding (class_name:
// "WafergraphMCP") can resolve it from this Worker's main module.
export { WafergraphMCP };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(renderLanding(url.origin), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return WafergraphMCP.serve("/mcp", { binding: "WAFERGRAPH_MCP" }).fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
