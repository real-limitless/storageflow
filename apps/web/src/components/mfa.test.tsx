import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserLocation } from "@/lib/api";
import { MfaEnroll } from "./mfa";

const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderEnroll() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MfaEnroll enabled={false} />
    </QueryClientProvider>,
  );
}

describe("MFA enrollment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stays on the enrollment page when the code is rejected", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/app/security");
    const assign = vi.spyOn(browserLocation, "assign").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/me/mfa/enroll") && init?.method === "POST") {
          return json({
            secret,
            otpauth: "otpauth://totp/StorageFlow:ada@acme.test?secret=GEZD",
            recoveryCodes: ["ABCD-EFGH", "IJKL-MNOP"],
          });
        }
        if (url.endsWith("/me/mfa/confirm") && init?.method === "POST") {
          return json({ error: { code: "unauthorized", message: "That code was not accepted" } }, 401);
        }
        return json({ error: { code: "not_found", message: "missing" } }, 404);
      }),
    );

    renderEnroll();
    await user.click(screen.getByRole("button", { name: "Set up authenticator" }));
    expect(await screen.findByText(secret)).toBeTruthy();

    await user.type(screen.getByLabelText("Authenticator code"), "000000");
    await user.click(screen.getByRole("button", { name: "Turn on authenticator" }));

    expect(await screen.findByText("That code was not accepted")).toBeTruthy();
    expect(screen.getByLabelText("Authenticator code")).toBeTruthy();
    expect(screen.getByText("ABCD-EFGH")).toBeTruthy();
    expect(screen.queryByText("Authenticator is on. The next sign-in asks for a code from the app, or a recovery code.")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/app/security");
  });
});
