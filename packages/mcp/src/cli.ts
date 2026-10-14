import { createRestClient } from "./client.js";
import { startStdioServer } from "./server.js";

const apiKey = process.env.STORAGEFLOW_API_KEY?.trim() ?? "";
const session = process.env.STORAGEFLOW_SESSION?.trim() ?? "";
const baseUrl = process.env.STORAGEFLOW_API_URL?.trim() || "http://127.0.0.1:8787";

if (!apiKey && !session) {
  console.error("storageflow-mcp: set STORAGEFLOW_SESSION or STORAGEFLOW_API_KEY");
}

const client = createRestClient({
  baseUrl,
  apiKey: apiKey || undefined,
  session: apiKey ? undefined : session || undefined,
});

await startStdioServer(client);
