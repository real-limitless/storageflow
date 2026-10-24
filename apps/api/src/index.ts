import { serve } from "@hono/node-server";
import { createResolver } from "./adapters.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { createExtractiveAnswerer, createHashEmbedder, createHttpAnswerer, createHttpEmbedder } from "./embed.js";
import { JobQueue } from "./jobs.js";
import { createLogger, runtimeEvent } from "./log.js";
import { migrate } from "./migrate.js";
import { seedOwner } from "./services/account.js";
import { watchUnindexedEmbeddings } from "./services/semantic.js";

const config = loadConfig();
const logger = createLogger();
const now = () => new Date();
if (!config.databaseUrl) {
  logger.write(runtimeEvent(config, now(), "process.config", "failure", "DATABASE_URL is not set"));
  process.exit(1);
}

const db = await openDatabase(config.databaseUrl);
await migrate(db);
const deps = {
  db,
  adapters: createResolver(config.adapterMode),
  config,
  jobs: new JobQueue((error) => {
    const message = error instanceof Error ? error.message : "Job failed";
    logger.write(runtimeEvent(config, now(), "job.fail", "failure", message));
  }),
  embedder: config.embeddingUrl
    ? createHttpEmbedder({ url: config.embeddingUrl, apiKey: config.embeddingApiKey, model: config.embeddingModel })
    : createHashEmbedder(),
  answerer: config.answerUrl
    ? createHttpAnswerer({ url: config.answerUrl, apiKey: config.answerApiKey, model: config.answerModel })
    : createExtractiveAnswerer(),
  logger,
  now,
};
await seedOwner(deps);
watchUnindexedEmbeddings(deps);
const app = createApp(deps);
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  logger.write(runtimeEvent(config, now(), "process.start", "success", "API listening"));
});
