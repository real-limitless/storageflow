import type { LocationTab, Project } from "@storageflow/domain";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CabinetTabs } from "@/components/cabinet-tabs";
import { ProjectCreateDialog } from "@/components/dialogs";
import { CabinetCombobox } from "@/components/header";
import { cabinetTabs, closeCabinetTab, filterCabinets, neighborAfterClose, restoreCabinetTab } from "@/lib/cabinets";

function cabinet(id: string, name: string, kind: Project["kind"] = "custom"): Project {
  return {
    id,
    tenantId: "tenant",
    name,
    kind,
    description: "",
    color: null,
    starred: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    role: "owner",
  };
}

const work = cabinet("work", "Work", "work");
const personal = cabinet("personal", "Personal", "personal");
const school = cabinet("school", "School", "school");

describe("cabinet search", () => {
  it("filters the combobox by name", async () => {
    const user = userEvent.setup();
    render(<CabinetCombobox cabinets={[work, personal, school]} currentId="work" onOpen={vi.fn()} onCreate={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: /cabinets/i }));
    await user.type(screen.getByRole("textbox", { name: "Search cabinets" }), "sch");
    expect(screen.getByRole("option", { name: /School/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Work/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Personal/ })).toBeNull();
    expect(screen.getByRole("option", { name: "New cabinet…" })).toBeTruthy();
  });

  it("filters by kind when the name does not match", () => {
    expect(filterCabinets([work, personal, school], "personal").map((item) => item.id)).toEqual(["personal"]);
    expect(filterCabinets([work, personal], "WORK").map((item) => item.id)).toEqual(["work"]);
  });
});

describe("keyboard", () => {
  it("opens the highlighted cabinet with the arrow keys", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onCreate = vi.fn();
    render(<CabinetCombobox cabinets={[work, personal]} currentId="work" onOpen={onOpen} onCreate={onCreate} />);
    await user.click(screen.getByRole("combobox", { name: /cabinets/i }));
    await user.click(screen.getByRole("textbox", { name: "Search cabinets" }));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onCreate).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "personal" }));
  });
});

describe("current cabinet", () => {
  it("marks the open cabinet in the combobox", async () => {
    const user = userEvent.setup();
    render(<CabinetCombobox cabinets={[work, personal]} currentId="work" onOpen={vi.fn()} onCreate={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: /cabinets/i }));
    const current = screen.getByRole("option", { name: /Work/ });
    expect(current.getAttribute("aria-selected")).toBe("true");
    expect(current.getAttribute("data-current")).toBe("true");
    expect(current.textContent).toContain("Current");
    expect(screen.getByRole("option", { name: /Personal/ }).getAttribute("aria-selected")).toBe("false");
  });
});

describe("cabinet dialog", () => {
  it("shows an empty list", () => {
    render(
      <ProjectCreateDialog open projects={[]} currentId={null} onOpenChange={vi.fn()} onSwitch={vi.fn()} onCreated={vi.fn()} />,
    );
    expect(screen.getByText("No cabinets yet")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New cabinet" })).toBeTruthy();
  });

  it("shows a visible error when the name is empty", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(
      <ProjectCreateDialog open projects={[]} currentId={null} onOpenChange={vi.fn()} onSwitch={vi.fn()} onCreated={onCreated} />,
    );
    await user.click(screen.getByRole("button", { name: "Create cabinet" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Name is required");
    expect(onCreated).not.toHaveBeenCalled();
  });
});

const workTab: LocationTab = {
  id: "work",
  projectId: "work",
  title: "Work",
  url: "/app/p/work/d/drawer-1/f/folder-1?select=file-1",
  select: "file-1",
};
const personalTab: LocationTab = {
  id: "personal",
  projectId: "personal",
  title: "Personal",
  url: "/app/p/personal?select=drawer-2",
  select: "drawer-2",
};

function TabHarness() {
  const [tabs, setTabs] = useState<LocationTab[]>([workTab, personalTab]);
  const [active, setActive] = useState("work");
  const closed = useRef<LocationTab | null>(null);
  return (
    <>
      <CabinetTabs
        tabs={tabs}
        activeId={active}
        onActivate={(tab) => setActive(tab.projectId ?? tab.id)}
        onClose={(id) => {
          closed.current = tabs.find((tab) => tab.projectId === id) ?? null;
          const neighbor = neighborAfterClose(tabs, id);
          setTabs(closeCabinetTab(tabs, id));
          if (active === id) setActive(neighbor?.projectId ?? "");
        }}
        onReorder={() => undefined}
      />
      <button
        type="button"
        onClick={() => {
          const tab = closed.current;
          if (!tab) return;
          setTabs((current) => restoreCabinetTab(current, tab));
          setActive(tab.projectId ?? tab.id);
        }}
      >
        Restore closed tab
      </button>
    </>
  );
}

describe("saved cabinet paths", () => {
  it("repairs a tab whose path belongs to another cabinet", () => {
    const repaired = cabinetTabs([{ id: "work", projectId: "work", title: "Work", url: "/app/p/personal?select=file-1", select: "file-1" }]);
    expect(repaired[0]?.url).toBe("/app/p/work");
    expect(repaired[0]?.select).toBe("");
  });
});

describe("cabinet tabs", () => {
  it("closes a tab and restores its path and selection", async () => {
    const user = userEvent.setup();
    render(<TabHarness />);
    expect(screen.getByRole("tab", { name: /Work/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /Personal/ }).getAttribute("aria-selected")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Close Personal" }));
    expect(screen.queryByRole("tab", { name: /Personal/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /Work/ }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Restore closed tab" }));
    const restored = screen.getByRole("tab", { name: /Personal/ });
    expect(restored.getAttribute("aria-selected")).toBe("true");
    expect(restored.getAttribute("data-path")).toBe(personalTab.url);
    expect(restored.getAttribute("data-select")).toBe("drawer-2");
  });
});
