import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TeamOnboarding } from "./team-onboarding";

afterEach(() => {
  cleanup();
});

describe("team onboarding", () => {
  it("shows an error when the team name is empty", () => {
    render(<TeamOnboarding onCreated={() => undefined} />);
    fireEvent.submit(screen.getByRole("form", { name: "Name your team" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a team name.");
  });

  it("shows an error when the team name is only spaces", () => {
    render(<TeamOnboarding onCreated={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "   " } });
    fireEvent.submit(screen.getByRole("form", { name: "Name your team" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a team name.");
  });
});
