export interface RestResult {
  status: number;
  body: unknown;
}

export interface RestClientOptions {
  baseUrl?: string;
  session?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface RestRequest {
  json?: unknown;
  raw?: Uint8Array;
  contentType?: string;
}

export interface RestClient {
  request(method: string, path: string, options?: RestRequest): Promise<RestResult>;
}

export function createRestClient(options: RestClientOptions = {}): RestClient {
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:8787";
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async request(method, path, request) {
      const headers = new Headers();
      if (options.apiKey) headers.set("authorization", `Bearer ${options.apiKey}`);
      else if (options.session) headers.set("cookie", `sf_session=${options.session}`);
      let body: BodyInit | undefined;
      if (request?.raw) {
        body = Buffer.from(request.raw);
        headers.set("content-length", String(request.raw.byteLength));
        if (request.contentType) headers.set("content-type", request.contentType);
      } else if (request?.json !== undefined) {
        body = JSON.stringify(request.json);
        headers.set("content-type", "application/json");
      }
      const response = await fetchImpl(new URL(path, baseUrl), { method, headers, body });
      const text = await response.text();
      if (!text) return { status: response.status, body: null };
      const type = response.headers.get("content-type") ?? "";
      if (type.includes("json") || text.startsWith("{") || text.startsWith("[")) {
        return { status: response.status, body: JSON.parse(text) as unknown };
      }
      return { status: response.status, body: text };
    },
  };
}
