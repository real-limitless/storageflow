import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import pg from "pg";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function openDatabase(databaseUrl: string): Promise<Db> {
  if (!databaseUrl || databaseUrl.startsWith("pglite:")) {
    const dir = databaseUrl.startsWith("pglite:") ? databaseUrl.slice("pglite:".length) || undefined : undefined;
    const client = new PGlite({
      ...(dir ? { dataDir: dir } : {}),
      extensions: { vector },
    });
    await client.waitReady;
    const wrap = (queryable: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, nested = false): Db => ({
      async query(sql, params) {
        const result = await queryable.query(sql, params ?? []);
        return result.rows as never;
      },
      async exec(sql) {
        if (nested) {
          await queryable.query(sql);
          return;
        }
        await client.exec(sql);
      },
      async transaction(fn) {
        if (nested) return fn(wrap(queryable, true));
        return client.transaction(async (tx) => fn(wrap(tx, true)));
      },
      async close() {
        if (!nested) await client.close();
      },
    });
    return wrap(client);
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const wrap = (queryable: pg.Pool | pg.PoolClient, nested = false): Db => ({
    async query(sql, params) {
      const result = await queryable.query(sql, params as unknown[]);
      return result.rows as never;
    },
    async exec(sql) {
      await queryable.query(sql);
    },
    async transaction(fn) {
      if (nested) return fn(wrap(queryable, true));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client, true));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      if (!nested) await pool.end();
    },
  });
  return wrap(pool);
}
