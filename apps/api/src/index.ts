import { serve } from "@hono/node-server";
import { createResolver } from "./adapters.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { JobQueue } from "./jobs.js";
import { migrate } from "./migrate.js";
import { seedOwner } from "./services/account.js";

const config = loadConfig();
if (!config.databaseUrl) {
  console.error("Set DATABASE_URL to a Postgres connection string, or pglite:./data/pglite for a local file.");
  process.exit(1);
}

const db = await openDatabase(config.databaseUrl);
await migrate(db);
const deps = {
  db,
  adapters: createResolver(config.adapterMode),
  config,
  jobs: new JobQueue(),
  now: () => new Date(),
};
await seedOwner(deps);
const app = createApp(deps);
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`StorageFlow API listening on ${port}`);
});
