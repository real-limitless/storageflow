export interface ExplorerSearch {
  df: string;
  dc: string;
  ff: string;
  fc: string;
  qf: string;
  qc: string;
  sort: string;
  dir: "asc" | "desc";
  view?: "grid" | "list" | "details";
  select: string;
}

export function validateExplorerSearch(search: Record<string, unknown>): ExplorerSearch {
  const text = (key: string) => (typeof search[key] === "string" ? String(search[key]) : "");
  const view = search.view === "grid" || search.view === "list" || search.view === "details" ? search.view : undefined;
  return {
    df: text("df"),
    dc: text("dc"),
    ff: text("ff"),
    fc: text("fc"),
    qf: text("qf"),
    qc: text("qc"),
    sort: text("sort") || "name",
    dir: search.dir === "desc" ? "desc" : "asc",
    view,
    select: text("select"),
  };
}
