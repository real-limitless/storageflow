import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTree,
  chunkDelayMs,
  cooldownRemaining,
  coversKey,
  dailyRemaining,
  DEFAULT_TRANSFER_SETTINGS,
  grantAllowsVerb,
  isDescendantKey,
  isDropFolder,
  isInsidePrefix,
  joinKey,
  limitsFor,
  replaceKeyPrefix,
  ticketWindow,
  verbsForNode,
  type GrantCheck,
} from "../src/index.js";

test("prefix joins and containment ignore display names", () => {
  assert.equal(joinKey("clients", "Adams"), "clients/Adams");
  assert.equal(joinKey("clients/", "Adams"), "clients/Adams");
  assert.equal(isInsidePrefix("clients/", "clients/Adams/notes.txt"), true);
  assert.equal(isInsidePrefix("clients/", "clients-other/notes.txt"), false);
  assert.equal(isInsidePrefix("clients/", "../secrets"), false);
  assert.throws(() => joinKey("clients/", "../x"));
  assert.equal(coversKey("a/b/", "a/b/c.txt", "folder"), true);
  assert.equal(coversKey("a/b/", "a/c.txt", "folder"), false);
  assert.equal(coversKey("a/b.txt", "a/b.txt", "file"), true);
  assert.equal(coversKey("a/b.txt", "a/b.txt.bak", "file"), false);
  assert.equal(isDescendantKey("a/b/", "a/b/c/"), true);
  assert.equal(isDescendantKey("a/b/", "a/b/"), false);
  assert.equal(replaceKeyPrefix("a/b/c.txt", "a/b/", "a/d/"), "a/d/c.txt");
});

test("folder tree roots are only the drawer root's children", () => {
  const folders = [
    { id: "root", parentId: null, name: "root" },
    { id: "consulting", parentId: "root", name: "Consulting" },
    { id: "notes", parentId: "consulting", name: "Notes" },
    { id: "scans", parentId: "root", name: "Scans" },
  ];
  const tree = buildTree(folders, "root");
  assert.deepEqual(tree.map((node) => node.item.name), ["Consulting", "Scans"]);
  assert.deepEqual(tree[0]?.children.map((node) => node.item.name), ["Notes"]);
  const flat = JSON.stringify(tree);
  assert.equal(flat.split("Notes").length - 1, 1);
  assert.equal(flat.split("Consulting").length - 1, 1);
});

test("grants cover descendants and stop at siblings", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const grant: GrantCheck = {
    backendKey: "drawers/1/biology/",
    nodeKind: "folder",
    verbs: ["list", "download"],
    expiresAt: null,
    downloadCap: 2,
    downloadCount: 0,
  };
  assert.deepEqual(verbsForNode([grant], "drawers/1/biology/lab.pdf", now), ["list", "download"]);
  assert.deepEqual(verbsForNode([grant], "drawers/1/chemistry/lab.pdf", now), []);
  assert.equal(grantAllowsVerb({ ...grant, downloadCount: 2 }, "download", now), false);
  assert.equal(grantAllowsVerb({ ...grant, expiresAt: "2026-10-13T11:00:00Z" }, "list", now), false);
  assert.equal(isDropFolder(["upload"]), true);
  assert.equal(isDropFolder(["upload", "list"]), false);
});

test("free and paid ticket windows come from plan limits", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const free = limitsFor("free", DEFAULT_TRANSFER_SETTINGS);
  const paid = limitsFor("paid", DEFAULT_TRANSFER_SETTINGS);
  assert.equal(free.waitSeconds, 30);
  assert.equal(paid.waitSeconds, 0);
  const freeWindow = ticketWindow(now, free);
  assert.equal(freeWindow.readyAt.toISOString(), "2026-10-13T12:00:30.000Z");
  const paidWindow = ticketWindow(now, paid);
  assert.equal(paidWindow.readyAt.toISOString(), now.toISOString());
  assert.equal(cooldownRemaining(now, new Date("2026-10-13T11:59:30Z"), 60), 30_000);
  assert.equal(dailyRemaining(100, 40), 0);
  assert.equal(chunkDelayMs(50_000, 50_000), 1000);
});
