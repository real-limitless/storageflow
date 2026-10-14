import fs from "node:fs";
import type { Db } from "./db.js";

export async function migrate(db: Db): Promise<void> {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL)");
  const done = await db.query("SELECT id FROM schema_migrations WHERE id = $1", ["001"]);
  if (done.length > 0) return;
  const sql = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  await db.exec(sql);
  await db.query("INSERT INTO schema_migrations (id, applied_at) VALUES ('001', CURRENT_TIMESTAMP)");
}
