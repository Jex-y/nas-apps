import { createJobQueue, createSql, parseServerConfig, startServer } from "@nas/core";
import { createApps } from "./apps";

const config = parseServerConfig(process.env);
const sql = createSql(config.database);
const server = startServer({
  port: config.port,
  development: config.development,
  apps: createApps({
    sql,
    blob: config.blob,
    notify: config.notify,
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
