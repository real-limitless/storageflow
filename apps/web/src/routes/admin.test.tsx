import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateUserForm, DisableAccountForm } from "./admin";

afterEach(() => cleanup());

describe("create user form", () => {
  it("submits name, email, password, and role", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CreateUserForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("Name"), "Mira Chen");
    await user.type(screen.getByLabelText("Email"), "mira@acme.test");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.selectOptions(screen.getByLabelText("Role"), "owner");
    await user.click(screen.getByRole("button", { name: "Create user" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Mira Chen",
      email: "mira@acme.test",
      password: "correct-horse",
      role: "owner",
    });
  });

  it("shows the error when create fails", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error("A password of 8 characters is required"));
    render(<CreateUserForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("Name"), "Mira Chen");
    await user.type(screen.getByLabelText("Email"), "mira@acme.test");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create user" }));
    expect((await screen.findByRole("alert")).textContent).toContain("A password of 8 characters is required");
  });
});

describe("disable form", () => {
  it("disables the account", async () => {
    const user = userEvent.setup();
    const onDisable = vi.fn().mockResolvedValue(undefined);
    render(
      <DisableAccountForm
        account={{ id: "bob", name: "Bob", disabledAt: null }}
        onDisable={onDisable}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Disable" }));
    expect(onDisable).toHaveBeenCalledWith("bob");
  });

  it("hides the control after the account is disabled", () => {
    render(
      <DisableAccountForm
        account={{ id: "bob", name: "Bob", disabledAt: "2026-10-14T12:00:00.000Z" }}
        onDisable={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
  });
});
