import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInPage } from "./sign-in";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderSignIn() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/sign-in",
    component: SignInPage,
  });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/app",
    component: () => <h1>Cabinet home</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([signInRoute, appRoute]),
    history: createMemoryHistory({ initialEntries: ["/sign-in"] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("MFA challenge gate", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/sign-in");
    window.scrollTo = () => undefined;
  });

  it("stays on the challenge until a code is accepted", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as { code?: string }) : {};
      if (url.endsWith("/sessions") && init?.method === "POST") {
        return json({ mfaRequired: true, challenge: "chal-1" });
      }
      if (url.endsWith("/sessions/mfa") && body.code === "000000") {
        return json({ error: { code: "unauthorized", message: "That code was not accepted" } }, 401);
      }
      if (url.endsWith("/sessions/mfa")) return json({ user: { name: "Ada" }, activeTenant: { id: "t", name: "Acme" } });
      return json({ error: { code: "not_found", message: "missing" } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSignIn();
    await user.type(await screen.findByLabelText("Email"), "ada@acme.test");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Check your authenticator" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Cabinet home" })).toBeNull();

    await user.type(screen.getByLabelText("Code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("That code was not accepted")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Cabinet home" })).toBeNull();

    await user.clear(screen.getByLabelText("Code"));
    await user.type(screen.getByLabelText("Code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("heading", { name: "Cabinet home" })).toBeTruthy();
  });
});
