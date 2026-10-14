import { z, type ZodRawShape } from "zod";
import type { RestClient, RestResult } from "./client.js";

export interface ToolOutcome {
  isError: boolean;
  status: number;
  text: string;
  body: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input: ZodRawShape;
  run: (client: RestClient, args: Record<string, unknown>) => Promise<ToolOutcome>;
}

class ToolInputError extends Error {
  status = 400;
}

function requiredString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || !value.trim()) throw new ToolInputError(`${field} is required`);
  return value.trim();
}

function requiredText(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string") throw new ToolInputError(`${field} is required`);
  return value;
}

function bodyFrom(args: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    if (args[field] !== undefined) body[field] = args[field];
  }
  return body;
}

function errorMessage(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string") return error.message;
  }
  if (typeof body === "string" && body) return body;
  return null;
}

function fromRest(result: RestResult): ToolOutcome {
  if (result.status >= 400) {
    return {
      isError: true,
      status: result.status,
      text: errorMessage(result.body) ?? `HTTP ${result.status}`,
      body: result.body,
    };
  }
  const text = typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2);
  return { isError: false, status: result.status, text, body: result.body };
}

async function route(client: RestClient, method: string, path: string, json?: Record<string, unknown>): Promise<ToolOutcome> {
  return fromRest(await client.request(method, path, json === undefined ? undefined : { json }));
}

export const tools: ToolDefinition[] = [
  {
    name: "get_team",
    description: "Read the signed-in user and the active team. The team is the tenant.",
    input: {},
    run: (client) => route(client, "GET", "/me"),
  },
  {
    name: "create_team",
    description: "Create a team with POST /tenants. The caller becomes the owner. There is no rename or delete route.",
    input: { name: z.string(), slug: z.string().optional() },
    run: (client, args) =>
      route(client, "POST", "/tenants", {
        name: requiredString(args, "name"),
        ...bodyFrom(args, ["slug"]),
      }),
  },
  {
    name: "list_cabinets",
    description: "List cabinets in the active team. The route is GET /projects.",
    input: {},
    run: (client) => route(client, "GET", "/projects"),
  },
  {
    name: "create_cabinet",
    description: "Create a cabinet with POST /projects. kind is work, personal, school, sports, or custom.",
    input: { name: z.string(), kind: z.string(), description: z.string().optional() },
    run: (client, args) =>
      route(client, "POST", "/projects", {
        name: requiredString(args, "name"),
        kind: requiredString(args, "kind"),
        ...bodyFrom(args, ["description"]),
      }),
  },
  {
    name: "update_cabinet",
    description: "Update a cabinet with PATCH /projects/:id.",
    input: {
      id: z.string(),
      name: z.string().optional(),
      kind: z.string().optional(),
      description: z.string().optional(),
      color: z.string().nullable().optional(),
      starred: z.boolean().optional(),
    },
    run: (client, args) => route(client, "PATCH", `/projects/${requiredString(args, "id")}`, bodyFrom(args, ["name", "kind", "description", "color", "starred"])),
  },
  {
    name: "delete_cabinet",
    description: "Delete a cabinet with DELETE /projects/:id.",
    input: { id: z.string() },
    run: (client, args) => route(client, "DELETE", `/projects/${requiredString(args, "id")}`),
  },
  {
    name: "list_drawers",
    description: "List drawers in a cabinet. The route is GET /projects/:id/drawers.",
    input: { cabinetId: z.string() },
    run: (client, args) => route(client, "GET", `/projects/${requiredString(args, "cabinetId")}/drawers`),
  },
  {
    name: "create_drawer",
    description: "Create a drawer with POST /projects/:id/drawers. mode is hosted or linked.",
    input: {
      cabinetId: z.string(),
      name: z.string(),
      mode: z.string().optional(),
      endpoint: z.string().optional(),
      region: z.string().optional(),
      bucket: z.string().optional(),
      prefix: z.string().optional(),
      pathStyle: z.boolean().optional(),
      accessKey: z.string().optional(),
      secretKey: z.string().optional(),
      notes: z.string().optional(),
    },
    run: (client, args) =>
      route(
        client,
        "POST",
        `/projects/${requiredString(args, "cabinetId")}/drawers`,
        { name: requiredString(args, "name"), ...bodyFrom(args, ["mode", "endpoint", "region", "bucket", "prefix", "pathStyle", "accessKey", "secretKey", "notes"]) },
      ),
  },
  {
    name: "update_drawer",
    description: "Update a drawer with PATCH /drawers/:id.",
    input: {
      id: z.string(),
      name: z.string().optional(),
      notes: z.string().optional(),
      color: z.string().nullable().optional(),
      starred: z.boolean().optional(),
      sortOrder: z.number().optional(),
    },
    run: (client, args) => route(client, "PATCH", `/drawers/${requiredString(args, "id")}`, bodyFrom(args, ["name", "notes", "color", "starred", "sortOrder"])),
  },
  {
    name: "delete_drawer",
    description: "Delete a drawer with DELETE /drawers/:id.",
    input: { id: z.string() },
    run: (client, args) => route(client, "DELETE", `/drawers/${requiredString(args, "id")}`),
  },
  {
    name: "list_folder",
    description: "List folders and files with GET /drawers/:id/list.",
    input: { drawerId: z.string(), folderId: z.string() },
    run: (client, args) => {
      const query = new URLSearchParams({ folderId: requiredString(args, "folderId") });
      return route(client, "GET", `/drawers/${requiredString(args, "drawerId")}/list?${query}`);
    },
  },
  {
    name: "create_folder",
    description: "Create a folder with POST /drawers/:id/folders.",
    input: { drawerId: z.string(), parentId: z.string(), name: z.string() },
    run: (client, args) =>
      route(client, "POST", `/drawers/${requiredString(args, "drawerId")}/folders`, {
        parentId: requiredString(args, "parentId"),
        name: requiredString(args, "name"),
      }),
  },
  {
    name: "update_folder",
    description: "Rename, star, or color a folder with PATCH /nodes/:id.",
    input: { id: z.string(), name: z.string().optional(), starred: z.boolean().optional(), color: z.string().nullable().optional() },
    run: (client, args) => route(client, "PATCH", `/nodes/${requiredString(args, "id")}`, bodyFrom(args, ["name", "starred", "color"])),
  },
  {
    name: "delete_folder",
    description: "Delete a folder with POST /nodes/delete.",
    input: { id: z.string() },
    run: (client, args) => route(client, "POST", "/nodes/delete", { nodeIds: [requiredString(args, "id")] }),
  },
  {
    name: "create_file",
    description: "Upload a text file through POST /drawers/:id/uploads, PUT /uploads/:id/body, and POST /uploads/:id/complete.",
    input: { drawerId: z.string(), folderId: z.string(), name: z.string(), text: z.string(), contentType: z.string().optional() },
    run: async (client, args) => {
      const drawerId = requiredString(args, "drawerId");
      const folderId = requiredString(args, "folderId");
      const name = requiredString(args, "name");
      const text = requiredText(args, "text");
      const contentType = typeof args.contentType === "string" && args.contentType ? args.contentType : "text/plain";
      const bytes = new TextEncoder().encode(text);
      const started = await client.request("POST", `/drawers/${drawerId}/uploads`, {
        json: { folderId, name, size: bytes.byteLength, contentType },
      });
      if (started.status >= 400) return fromRest(started);
      const uploadId = started.body && typeof started.body === "object" && "uploadId" in started.body ? String(started.body.uploadId) : "";
      if (!uploadId) return { isError: true, status: 500, text: "Upload did not start", body: started.body };
      const written = await client.request("PUT", `/uploads/${uploadId}/body`, { raw: bytes, contentType });
      if (written.status >= 400) return fromRest(written);
      return fromRest(await client.request("POST", `/uploads/${uploadId}/complete`, { json: {} }));
    },
  },
  {
    name: "read_file",
    description: "Read file bytes with GET /nodes/:id/content.",
    input: { id: z.string() },
    run: (client, args) => route(client, "GET", `/nodes/${requiredString(args, "id")}/content`),
  },
  {
    name: "update_file",
    description: "Rename, star, or color a file with PATCH /nodes/:id.",
    input: { id: z.string(), name: z.string().optional(), starred: z.boolean().optional(), color: z.string().nullable().optional() },
    run: (client, args) => route(client, "PATCH", `/nodes/${requiredString(args, "id")}`, bodyFrom(args, ["name", "starred", "color"])),
  },
  {
    name: "delete_file",
    description: "Delete a file with POST /nodes/delete. A key whose scopes omit delete is denied.",
    input: { id: z.string() },
    run: (client, args) => route(client, "POST", "/nodes/delete", { nodeIds: [requiredString(args, "id")] }),
  },
];

const byName = new Map(tools.map((tool) => [tool.name, tool]));

export async function callTool(client: RestClient, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const tool = byName.get(name);
  if (!tool) return { isError: true, status: 404, text: `Unknown tool ${name}`, body: null };
  try {
    return await tool.run(client, args);
  } catch (error) {
    if (error instanceof ToolInputError) return { isError: true, status: error.status, text: error.message, body: null };
    throw error;
  }
}
