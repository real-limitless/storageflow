import type { LabelColor } from "@storageflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { FileDialog, FolderDialog } from "@/components/dialogs";
import { DeleteConfirm, ItemMenu } from "@/components/item-menu";
import { PropertiesPane, type PropertiesTarget } from "@/components/properties-pane";

const menuHandlers = {
  starred: false,
  writesEnabled: true,
  canRename: true,
  canDelete: true,
  canMoveUp: true,
  canMoveDown: true,
  canCreate: true,
  onStar: vi.fn(),
  onColor: vi.fn<(color: LabelColor | null) => void>(),
  onRename: vi.fn(),
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
  onDelete: vi.fn(),
  onNewFolder: vi.fn(),
  onNewFile: vi.fn(),
  onUpload: vi.fn(),
  onProperties: vi.fn(),
};

function renderMenu(label: string, onDelete = vi.fn()) {
  render(
    <ItemMenu {...menuHandlers} onDelete={onDelete}>
      <button type="button">{label}</button>
    </ItemMenu>,
  );
  return onDelete;
}

async function openMenu(label: string) {
  const user = userEvent.setup();
  await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: label }) });
  return user;
}

describe("context menu entries", () => {
  it("offers star, color, rename, reorder, delete, and create on a drawer, folder, and file", async () => {
    for (const label of ["Clients", "Notes", "Brief.txt"]) {
      cleanup();
      renderMenu(label);
      await openMenu(label);
      expect(screen.getByRole("menuitem", { name: "Star" })).toBeTruthy();
      expect(screen.getByText("Color label")).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Blue" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Move up" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Move down" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "New folder" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "New file" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Upload" })).toBeTruthy();
    }
  });
});

describe("confirm delete", () => {
  it("asks before delete and only deletes after confirm", async () => {
    const user = userEvent.setup();
    const deleted = vi.fn();
    function Probe() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <ItemMenu {...menuHandlers} onDelete={() => setOpen(true)}>
            <button type="button">Brief.txt</button>
          </ItemMenu>
          <DeleteConfirm
            open={open}
            title="Delete Brief.txt?"
            description="Delete removes the selection on the backend, including everything inside a folder."
            onOpenChange={setOpen}
            onConfirm={deleted}
          />
        </>
      );
    }
    render(<Probe />);
    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "Brief.txt" }) });
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Delete Brief.txt?")).toBeTruthy();
    expect(deleted).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleted).toHaveBeenCalledOnce();
  });
});

function withClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("name rejection", () => {
  it("shows a visible error and does not create a folder with a bad name", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(withClient(<FolderDialog open onOpenChange={vi.fn()} drawerId="drawer" parentId="folder" scopeLabel="Notes" />));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "bad/name");
    await user.click(screen.getByRole("button", { name: "Create folder" }));
    expect(screen.getByTestId("name-error").textContent).toBe("Name cannot contain / or \\");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shows a visible error and does not create a file named ..", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(withClient(<FileDialog open onOpenChange={vi.fn()} drawerId="drawer" folderId="folder" scopeLabel="Notes" />));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "..");
    await user.click(screen.getByRole("button", { name: "Create file" }));
    expect(screen.getByTestId("name-error").textContent).toBe("Name cannot be . or ..");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("version restore", () => {
  it("calls the version restore API", async () => {
    const user = userEvent.setup();
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push({ url, method });
        if (url.endsWith("/restore")) {
          return new Response(JSON.stringify({ id: "file-1" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.endsWith("/versions")) {
          return new Response(
            JSON.stringify([
              {
                id: "ver-1",
                nodeId: "file-1",
                version: 1,
                storageKey: "versions/file-1/1",
                size: 4,
                authorUserId: "user",
                createdAt: "2026-03-01T12:00:00.000Z",
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/grants")) {
          return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.includes("/retention")) {
          return new Response(JSON.stringify({ count: 10 }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const target: PropertiesTarget = {
      kind: "file",
      id: "file-1",
      name: "Brief.txt",
      path: "s3://bucket/Brief.txt",
      size: 4,
      itemType: "txt",
      createdAt: "2026-03-01T12:00:00.000Z",
      modifiedAt: "2026-03-02T12:00:00.000Z",
      owner: "Chen Chiu",
      color: "blue",
      starred: true,
      shareNodeId: "file-1",
    };
    render(withClient(<PropertiesPane target={target} onClose={vi.fn()} />));
    expect(screen.getByText("Brief.txt")).toBeTruthy();
    expect(screen.getByText("Chen Chiu")).toBeTruthy();
    await screen.findByRole("button", { name: "Restore version 1" });
    await user.click(screen.getByRole("button", { name: "Restore version 1" }));
    await waitFor(() => {
      expect(calls).toContainEqual({ url: "/api/nodes/file-1/versions/1/restore", method: "POST" });
    });
    vi.unstubAllGlobals();
  });

  it("shows an empty state when nothing is selected", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ count: 10 }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    render(withClient(<PropertiesPane target={null} onClose={vi.fn()} />));
    expect(screen.getByTestId("properties-empty").textContent).toContain("Nothing selected");
    vi.unstubAllGlobals();
  });
});
