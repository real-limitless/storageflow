import { afterEach, describe, expect, it, vi } from "vitest";
import { api, browserLocation } from "./api";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api session redirect", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a missing session to sign-in", async () => {
    window.history.pushState({}, "", "/app/security");
    const assign = vi.spyOn(browserLocation, "assign").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "unauthorized", message: "Sign in" } }, 401)));

    await expect(api("/me")).rejects.toThrow("Sign in");
    expect(assign).toHaveBeenCalledWith("/sign-in");
  });
});
