/**
 * bureau-mcp
 *
 * MCP server that exposes a folder-based personal virtual organisation
 * (departments / TODOs / notes) to Claude.
 *
 * Configure with the env var `BUREAU_ROOT` pointing to your bureau folder
 * (e.g. an absolute path to a `.company/` directory).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildSchema } from "./lib/schema.js";
import { registerBureauTools } from "./tools/bureau.js";

const root = process.env["BUREAU_ROOT"];
if (!root) {
  console.error(
    "[bureau-mcp] BUREAU_ROOT is not set. Point it at your bureau folder, e.g.:\n" +
      '  claude mcp add bureau -e BUREAU_ROOT=/abs/path/.company -- node /abs/path/bureau-mcp/dist/index.js',
  );
  process.exit(1);
}

const schema = await buildSchema(root);

const server = new McpServer({
  name: "bureau-mcp",
  version: "0.1.0",
});

registerBureauTools(server, schema);

const transport = new StdioServerTransport();
await server.connect(transport);
