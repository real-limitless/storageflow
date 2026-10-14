import fs from "node:fs";
import type { Db } from "./db.js";

async function appliedIds(db: Db): Promise<Set<string>> {
  const rows = await db.query<{ id: string }>("SELECT id FROM schema_migrations");
  return new Set(rows.map((row) => String(row.id)));
}

async function mark(db: Db, id: string): Promise<void> {
  await db.query("INSERT INTO schema_migrations (id, applied_at) VALUES ($1, CURRENT_TIMESTAMP)", [id]);
}

export async function migrate(db: Db): Promise<void> {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL)");
  const applied = await appliedIds(db);
  if (!applied.has("001")) {
    const sql = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
    await db.exec(sql);
    await mark(db, "001");
    await mark(db, "002");
    await mark(db, "003");
    await mark(db, "004");
    return;
  }
  if (!applied.has("002")) {
    const sql = fs.readFileSync(new URL("./migrations/002.sql", import.meta.url), "utf8");
    await db.exec(sql);
    await mark(db, "002");
  }
  if (!applied.has("003")) {
    const sql = fs.readFileSync(new URL("./migrations/003.sql", import.meta.url), "utf8");
    await db.exec(sql);
    await mark(db, "003");
  }
  if (!applied.has("004")) {
    const sql = fs.readFileSync(new URL("./migrations/004.sql", import.meta.url), "utf8");
    await db.exec(sql);
    await mark(db, "004");
  }
}
