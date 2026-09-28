import { createJobQueue, createNotifierFactory, createSql, parseServerConfig, startServer } from "@nas/core";
import { createApps } from "./apps";

const config = parseServerConfig(process.env);
const sql = createSql(config.database);
const server = startServer({
  port: config.port,
  development: config.development,
  shell: { identity: config.identity, sql, webPush: config.notify.webPush },
  apps: createApps({
    env: process.env,
    publicUrl: config.publicUrl,
    sql,
    blob: config.blob,
    notifier: createNotifierFactory(config.notify, sql),
    jobs: createJobQueue(sql),
    identity: config.identity,
  }),
});

console.log(`Listening on ${server.url}`);

const shutdown = async () => {
  await server.stop();
  await sql.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
