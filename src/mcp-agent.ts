// MCP Durable Object: session init + tool registration only.
// Tool implementations live under src/tools/ (core = tools 1-9, then
// screen/geo/graph/deals). Every tool is a pure read over src/data.ts.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { DATA_SOURCE_MODE } from "./data";
import { recordSessionStart, isSelfTestClient } from "./usage";
import type { ToolCtx } from "./tools/shared";
import { registerCoreTools } from "./tools/core";
import { registerScreenTools } from "./tools/screen";
import { registerGeoTools } from "./tools/geo";
import { registerGraphTools } from "./tools/graphtools";
import { registerDealTools } from "./tools/deals";
import { registerMetaTools } from "./tools/meta";

type State = Record<string, never>;

export class WafergraphMCP extends McpAgent<Env, State, {}> {
  server = new McpServer({ name: "wafergraph-mcp", version: "1.3.2" });
  initialState: State = {};

  // Set once per session from the initialize handshake, then applied to every
  // tool call so our own probes never inflate the real adoption numbers.
  private selfTest = false;

  async init() {
    this.server.server.oninitialized = () => {
      const info = this.server.server.getClientVersion();
      this.selfTest = isSelfTestClient(info?.name);
      void recordSessionStart(this.env, info?.name, info?.version);
    };

    // ctx.isSelfTest is read at call time — the flag is set by initialize,
    // which happens after registration runs.
    const ctx: ToolCtx = { env: this.env, isSelfTest: () => this.selfTest };
    registerCoreTools(this.server, ctx);
    registerScreenTools(this.server, ctx);
    registerGeoTools(this.server, ctx);
    registerGraphTools(this.server, ctx);
    registerDealTools(this.server, ctx);
    registerMetaTools(this.server, ctx);
  }
}

export { DATA_SOURCE_MODE };
