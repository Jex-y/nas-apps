import {
  type AppContext,
  type AppMigrations,
  type AppModule,
  collectAppWork,
  createBlobStore,
  type JobStats,
  type JobsDatabase,
  readJobQueue,
  readMigrationState,
  readSchedules,
  ZERO_OUTCOMES,
  ZERO_QUEUE,
} from "@apps/core";
import { drizzle } from "drizzle-orm/bun-sql";
import { z } from "zod";
import type {
  AppSummary,
  JobFailure,
  JobQueue,
  JobSummary,
  Migrations,
  PostgresInfo,
  Probed,
  ScheduleStatus,
  ServerInfo,
  StatusReport,
} from "../contract";

/** A probe that has not answered by then is reported down rather than holding up the whole report. */
const PROBE_TIMEOUT_MS = 5_000;

const StatusEnv = z.object({
  /** Baked into the image by CI; empty when the image was built without it. */
  GIT_SHA: z.union([z.literal(""), z.string().regex(/^[0-9a-f]{40}$/)]).optional(),
});

export type BuildInfo = { readonly commit: string | null };

export const parseBuildInfo = (env: Readonly<Record<string, string | undefined>>): BuildInfo => {
  const result = StatusEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return { commit: result.data.GIT_SHA || null };
};

export type StatusDeps = {
  readonly context: AppContext;
  /** The apps the server hosts, whose work and migrations the report covers. */
  readonly apps: readonly AppModule[];
  readonly migrations: readonly AppMigrations[];
  readonly build: BuildInfo;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const probe = async <T>(run: (signal: AbortSignal) => Promise<T>): Promise<Probed<T>> => {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const timedOut = new Promise<never>((_, reject) =>
    signal.addEventListener("abort", () => reject(new Error(`No answer within ${PROBE_TIMEOUT_MS / 1000}s`)), {
      once: true,
    }),
  );
  try {
    return { status: "ok", value: await Promise.race([run(signal), timedOut]) };
  } catch (error) {
    return { status: "down", error: errorMessage(error) };
  }
};

type Timed<T> = { readonly latencyMs: number; readonly value: T };

const timed = async <T>(run: () => Promise<T>): Promise<Timed<T>> => {
  const start = performance.now();
  const value = await run();
  return { latencyMs: Math.round(performance.now() - start), value };
};

const DatabaseSize = z.tuple([z.object({ version: z.string(), bytes: z.coerce.number() })]);
const SchemaSizes = z.array(z.object({ name: z.string(), bytes: z.coerce.number() }));

const readPostgres = async ({ sql }: AppContext): Promise<PostgresInfo> => {
  const { latencyMs, value } = await timed(
    async () =>
      DatabaseSize.parse(
        await sql`select current_setting('server_version') as version, pg_database_size(current_database()) as bytes`,
      )[0],
  );
  const schemas = SchemaSizes.parse(
    await sql`
      select n.nspname as name, sum(pg_total_relation_size(c.oid)) as bytes
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'm') and n.nspname <> 'information_schema' and not starts_with(n.nspname, 'pg_')
      group by n.nspname
      order by bytes desc`,
  );
  return {
    latencyMs,
    version: value.version,
    databaseBytes: value.bytes,
    schemas,
  };
};

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

const toJobSummary = (name: string, registered: boolean, stats: JobStats | undefined): JobSummary => ({
  name,
  registered,
  ...(stats?.queue ?? ZERO_QUEUE),
  oldestReadyAt: iso(stats?.oldestReadyAt ?? null),
  last24h: stats?.outcomes ?? ZERO_OUTCOMES,
});

const readQueue = async (db: JobsDatabase, registered: ReadonlySet<string>): Promise<JobQueue> => {
  const snapshot = await readJobQueue(db, { windowHours: 24 });
  const byName = new Map(snapshot.jobs.map((stats) => [stats.name, stats]));
  return {
    jobs: [...new Set([...registered, ...byName.keys()])]
      .sort()
      .map((name) => toJobSummary(name, registered.has(name), byName.get(name))),
    hourly: snapshot.hourly.map(({ hour, ...outcomes }) => ({
      hour: hour.toISOString(),
      ...outcomes,
    })),
    recentFailures: snapshot.recentFailures.map((failure): JobFailure => {
      const common = {
        id: failure.id,
        name: failure.name,
        attempts: failure.attempts,
        maxAttempts: failure.maxAttempts,
        error: failure.error,
        failedAt: iso(failure.failedAt),
      };
      return failure.state === "dead"
        ? { ...common, state: "dead" }
        : {
            ...common,
            state: "retrying",
            nextAttemptAt: failure.nextAttemptAt.toISOString(),
          };
    }),
  };
};

const readScheduleStatuses = async (db: JobsDatabase, deps: StatusDeps): Promise<ScheduleStatus[]> =>
  (await readSchedules(db, collectAppWork(deps.apps).schedules)).map(
    (status): ScheduleStatus => ({
      name: status.name,
      everyMs: status.everyMs,
      jitterMs: status.jitterMs,
      lastEnqueued:
        status.lastEnqueued === null
          ? null
          : {
              slotStartedAt: status.lastEnqueued.slotStartedAt.toISOString(),
              runAt: status.lastEnqueued.runAt.toISOString(),
            },
      next:
        status.next.kind === "scheduled"
          ? { kind: "scheduled", runAt: status.next.runAt.toISOString() }
          : {
              kind: "overdue",
              slotStartedAt: status.next.slotStartedAt.toISOString(),
            },
    }),
  );

const toAppSummary = (app: AppModule): AppSummary => ({
  slug: app.slug,
  title: app.title,
  jobs: app.jobs.length,
  schedules: app.schedules.length,
});

export const createStatusReporter = (deps: StatusDeps) => {
  const { context } = deps;
  const db: JobsDatabase = drizzle({ client: context.sql });
  const blob = createBlobStore(context.blob, "status");
  const registeredJobs = new Set(collectAppWork(deps.apps).jobs.map((job) => job.name));

  return async (): Promise<StatusReport> => {
    const server: ServerInfo = {
      commit: deps.build.commit,
      bunVersion: Bun.version,
      uptimeSeconds: Math.round(process.uptime()),
    };
    const [postgres, blobCheck, queue, schedules, migrations] = await Promise.all([
      probe(() => readPostgres(context)),
      probe(async () => ({
        latencyMs: (await timed(() => blob.exists("probe"))).latencyMs,
      })),
      probe(() => readQueue(db, registeredJobs)),
      probe(() => readScheduleStatuses(db, deps)),
      probe(
        (): Promise<Migrations[]> =>
          Promise.all(
            deps.migrations.map(async (app) => ({
              slug: app.slug,
              state: await readMigrationState(context.sql, app),
            })),
          ),
      ),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      server,
      postgres,
      blob: blobCheck,
      queue,
      schedules,
      migrations,
      apps: deps.apps.map(toAppSummary),
    };
  };
};
