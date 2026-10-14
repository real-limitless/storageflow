import type { Node } from "@storageflow/domain";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DetailsTable } from "@/components/explorer";
import { FileCenterRibbon } from "@/components/ribbon";
import {
  DESKTOP_RIBBON_WIDTH,
  DETAIL_COLUMN_HEADERS,
  HOME_GROUPS,
  comingSoonCopy,
  fitRibbonRow,
  groupsForTab,
  isActionEnabled,
  ribbonAction,
  statusLabel,
  type RibbonSelection,
} from "@/lib/ribbon";

const emptySelection: RibbonSelection = {
  projectId: "work",
  drawerId: "",
  folderId: "",
  rootFolderId: "",
  writesEnabled: true,
  portalSlug: null,
  drawerIds: [],
  folderIds: [],
  fileIds: [],
};

function fileNode(id: string, name: string): Node {
  return {
    id,
    tenantId: "tenant",
    drawerId: "drawer",
    parentId: "folder",
    backendKey: name,
    kind: "file",
    name,
    size: 12,
    contentType: "text/plain",
    modifiedAt: "2026-03-01T12:00:00.000Z",
    starred: false,
    color: null,
    incomplete: false,
    cachedAt: "2026-03-01T12:00:00.000Z",
  };
}

describe("home ribbon order", () => {
  it("keeps the File Center actions in order", () => {
    expect(HOME_GROUPS.flat()).toEqual([
      "cabinets",
      "open",
      "email",
      "scan",
      "ocr",
      "portal",
      "split",
      "preview",
      "tools",
      "move",
      "namings",
      "templates",
      "separators",
      "cleanup",
      "actions",
      "convert",
      "combine",
      "extract",
      "settings",
      "guide",
      "help",
      "new-folder",
      "upload",
    ]);
  });
});

function renderRibbon(rowWidth?: number) {
  return render(
    <FileCenterRibbon
      tab="Home"
      onTabChange={vi.fn()}
      selection={emptySelection}
      onAction={vi.fn()}
      rowWidth={rowWidth}
      searchValue=""
      onSearchValue={vi.fn()}
      onSearch={vi.fn()}
      hits={null}
      searching={false}
      onOpenHit={vi.fn()}
    />,
  );
}

describe("home ribbon row", () => {
  it("does not wrap the Home ribbon to a second row at desktop width", async () => {
    const user = userEvent.setup();
    for (const tab of ["Home", "Inbox", "Manage", "Edit"] as const) {
      const layout = fitRibbonRow(groupsForTab(tab), DESKTOP_RIBBON_WIDTH);
      expect(layout.width).toBeLessThanOrEqual(DESKTOP_RIBBON_WIDTH);
      expect(layout.visible.length + layout.overflow.length).toBe(groupsForTab(tab).flat().length);
    }
    const home = fitRibbonRow(HOME_GROUPS, DESKTOP_RIBBON_WIDTH);
    for (const id of ["email", "scan", "ocr", "tools", "move"] as const) {
      expect(home.visible.map((item) => item.id)).toContain(id);
    }
    renderRibbon(DESKTOP_RIBBON_WIDTH);
    const row = screen.getByTestId("ribbon-row");
    expect(row.getAttribute("data-ribbon-rows")).toBe("1");
    expect(row.style.flexWrap).toBe("nowrap");
    expect(row.querySelectorAll(".ribbon-row")).toHaveLength(0);
    expect([...row.querySelectorAll<HTMLElement>("[data-action]")].map((node) => node.getAttribute("data-action"))).toEqual(home.visible.map((item) => item.id));
    if (home.overflow.length > 0) {
      await user.click(screen.getByRole("button", { name: "More actions" }));
      for (const id of home.overflow) {
        expect(screen.getByRole("menuitem", { name: new RegExp(ribbonAction(id).label) })).toBeTruthy();
      }
    }
  });
});

describe("coming soon versus live actions", () => {
  it("marks unfinished actions as coming soon and keeps wired actions live", () => {
    for (const id of ["email", "scan", "ocr", "split", "namings", "templates", "separators", "cleanup", "actions", "convert", "combine", "extract", "guide", "help"] as const) {
      expect(ribbonAction(id).availability).toBe("soon");
      expect(ribbonAction(id).issue).toBeGreaterThan(0);
    }
    expect(ribbonAction("tools")).toMatchObject({ availability: "soon", issue: 12 });
    expect(comingSoonCopy(ribbonAction("tools"))).toContain("#12");
    for (const id of ["cabinets", "open", "portal", "preview", "move", "settings", "new-folder", "upload"] as const) {
      expect(ribbonAction(id).availability).toBe("live");
    }
  });

  it("opens a coming soon note with the issue link", async () => {
    const user = userEvent.setup();
    render(
      <FileCenterRibbon
        tab="Home"
        onTabChange={vi.fn()}
        selection={emptySelection}
        onAction={vi.fn()}
        searchValue=""
        onSearchValue={vi.fn()}
        onSearch={vi.fn()}
        hits={null}
        searching={false}
        onOpenHit={vi.fn()}
      />,
    );
    const guide = screen.getByRole("button", { name: /Guide/ });
    expect(guide.getAttribute("data-soon")).toBe("true");
    expect(guide.hasAttribute("disabled")).toBe(false);
    await user.click(guide);
    expect(screen.getByRole("dialog").textContent).toContain("Guide is coming soon");
    expect(screen.getByRole("link", { name: "Issue #31" }).getAttribute("href")).toBe("https://github.com/real-limitless/storageflow/issues/31");
  });
});

describe("selection enabling", () => {
  it("disables preview and move until the selection can use them", () => {
    expect(isActionEnabled("preview", emptySelection)).toBe(false);
    expect(isActionEnabled("move", emptySelection)).toBe(false);
    expect(isActionEnabled("open", emptySelection)).toBe(false);
    expect(isActionEnabled("cabinets", emptySelection)).toBe(true);
    expect(isActionEnabled("email", emptySelection)).toBe(false);

    const oneFile: RibbonSelection = { ...emptySelection, drawerId: "drawer", folderId: "folder", fileIds: ["brief"] };
    expect(isActionEnabled("preview", oneFile)).toBe(true);
    expect(isActionEnabled("move", oneFile)).toBe(true);
    expect(isActionEnabled("open", oneFile)).toBe(true);
    expect(isActionEnabled("email", oneFile)).toBe(true);
    expect(isActionEnabled("combine", oneFile)).toBe(false);
    expect(isActionEnabled("combine", { ...oneFile, fileIds: ["brief", "notes"] })).toBe(true);
    expect(isActionEnabled("portal", oneFile)).toBe(false);
    expect(isActionEnabled("portal", { ...oneFile, portalSlug: "acme" })).toBe(true);
    expect(isActionEnabled("move", { ...oneFile, writesEnabled: false })).toBe(false);
    expect(isActionEnabled("upload", emptySelection)).toBe(false);
    expect(isActionEnabled("upload", { ...emptySelection, drawerId: "drawer", folderId: "folder" })).toBe(true);
  });

  it("renders preview disabled when nothing is selected", () => {
    render(
      <FileCenterRibbon
        tab="Home"
        onTabChange={vi.fn()}
        selection={emptySelection}
        onAction={vi.fn()}
        searchValue=""
        onSearchValue={vi.fn()}
        onSearch={vi.fn()}
        hits={null}
        searching={false}
        onOpenHit={vi.fn()}
      />,
    );
    const preview = screen.getByRole("button", { name: "Preview" });
    expect(preview.hasAttribute("disabled")).toBe(true);
    expect(preview.getAttribute("data-live")).toBe("true");
    expect(preview.getAttribute("title")).toBe("Select one file");
    expect(screen.getByRole("button", { name: "Move" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Email, coming soon" }).getAttribute("data-soon")).toBe("true");
  });
});

describe("detail column headers", () => {
  it("labels item type and date modified", () => {
    expect(DETAIL_COLUMN_HEADERS).toEqual(["Name", "Size", "Item type", "Date modified", "Color", "Star"]);
    render(<DetailsTable files={[fileNode("brief", "Brief.txt")]} selected={[]} onChoose={vi.fn()} onSort={vi.fn()} />);
    for (const header of DETAIL_COLUMN_HEADERS) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
    expect(statusLabel(0, 2, 1)).toBe("Nothing selected · 2 folders, 1 file");
    expect(statusLabel(3, 1, 0)).toBe("3 items selected · 1 folder, 0 files");
  });
});
