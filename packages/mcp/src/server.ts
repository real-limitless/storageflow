import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RestClient } from "./client.js";
import { callTool, tools } from "./tools.js";

export async function startStdioServer(client: RestClient): Promise<void> {
  const server = new McpServer({ name: "storageflow", version: "0.1.0" });
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.input, async (args) => {
      const outcome = await callTool(client, tool.name, args as Record<string, unknown>);
      return {
        isError: outcome.isError,
        content: [{ type: "text" as const, text: outcome.text }],
      };
    });
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
