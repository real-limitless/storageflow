export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") ?? "";
  const payload = type.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === "object" && payload?.error?.message ? String(payload.error.message) : response.statusText;
    const code = typeof payload === "object" && payload?.error?.code ? String(payload.error.code) : "error";
    if (response.status === 401 && typeof window !== "undefined") {
      const pathName = window.location.pathname;
      if (!pathName.startsWith("/sign-in") && !pathName.startsWith("/portal") && !pathName.startsWith("/d/") && !pathName.startsWith("/catalog")) {
        window.location.assign("/sign-in");
      }
    }
    throw new ApiError(response.status, code, message);
  }
  return payload as T;
}
