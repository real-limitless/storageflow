export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Browser navigation used by the API client. Tests replace these without touching window.location. */
export const browserLocation = {
  pathname(): string {
    return window.location.pathname;
  },
  assign(url: string) {
    window.location.assign(url);
  },
};

function returnToSignIn(status: number, message: string) {
  // A missing session says "Sign in". A rejected authenticator code is still signed in.
  if (status !== 401 || message !== "Sign in" || typeof window === "undefined") return;
  const pathName = browserLocation.pathname();
  if (pathName.startsWith("/sign-in") || pathName.startsWith("/portal") || pathName.startsWith("/d/") || pathName.startsWith("/catalog")) return;
  browserLocation.assign("/sign-in");
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
    returnToSignIn(response.status, message);
    throw new ApiError(response.status, code, message);
  }
  return payload as T;
}
