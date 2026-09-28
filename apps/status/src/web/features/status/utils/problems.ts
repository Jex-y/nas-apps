import type { JobSummary, Migrations, StatusReport } from "../../../../contract";
import { ageOf, formatDuration, formatRelative } from "./format";

export type Problem = {
  readonly severity: "error" | "warning";
  readonly message: string;
};

/** A ready job older than this means no worker is taking jobs, or the queue is backing up faster than it drains. */
export const STALE_READY_MS = 5 * 60_000;

const SERVICES = [
  ["postgres", "Postgres"],
  ["blob", "Object storage"],
] as const;

const serviceProblems = (report: StatusReport): Problem[] =>
  SERVICES.flatMap(([key, label]) => {
    const check = report[key];
    return check.status === "down"
      ? [
          {
            severity: "error",
            message: `${label} is unreachable: ${check.error}`,
          },
        ]
      : [];
  });

const NAMES_SHOWN = 3;

const listNames = (names: readonly string[]): string =>
  names.length <= NAMES_SHOWN
    ? names.join(", ")
    : `${names.slice(0, NAMES_SHOWN).join(", ")} and ${names.length - NAMES_SHOWN} more`;

/** One problem per kind, however many job names share it, so a noisy queue cannot bury the rest of the page. */
const queueProblems = (report: StatusReport): Problem[] => {
  if (report.queue.status === "down") {
    return [];
  }
  const jobs = report.queue.value.jobs;
  const staleFor = (job: JobSummary) => (job.oldestReadyAt === null ? 0 : ageOf(job.oldestReadyAt, report.generatedAt));
  const stale = jobs.filter((job) => job.registered && staleFor(job) > STALE_READY_MS);
  const orphaned = jobs.filter((job) => !job.registered && job.running + job.ready + job.waiting > 0);
  const dead = jobs.filter((job) => job.dead > 0);
  const total = (selected: readonly JobSummary[], count: (job: JobSummary) => number) =>
    selected.reduce((sum, job) => sum + count(job), 0);

  return [
    ...(stale.length > 0
      ? [
          {
            severity: "error" as const,
            message: `Ready jobs have waited up to ${formatDuration(Math.max(...stale.map(staleFor)))} in ${listNames(stale.map((job) => job.name))}; is the worker running?`,
          },
        ]
      : []),
    ...(orphaned.length > 0
      ? [
          {
            severity: "warning" as const,
            message: `${total(orphaned, (job) => job.running + job.ready + job.waiting)} queued jobs have no app to handle them: ${listNames(orphaned.map((job) => job.name))}.`,
          },
        ]
      : []),
    ...(dead.length > 0
      ? [
          {
            severity: "warning" as const,
            message: `${total(dead, (job) => job.dead)} dead jobs will not be retried: ${listNames(dead.map((job) => job.name))}.`,
          },
        ]
      : []),
  ];
};

const scheduleProblems = (report: StatusReport): Problem[] =>
  report.schedules.status === "down"
    ? []
    : report.schedules.value.flatMap((schedule): Problem[] =>
        schedule.next.kind === "overdue"
          ? [
              {
                severity: "error",
                message: `${schedule.name} has not been enqueued for the slot that started ${formatRelative(schedule.next.slotStartedAt, report.generatedAt)}; is the worker running?`,
              },
            ]
          : [],
      );

const migrationProblem = ({ slug, state }: Migrations): Problem[] => {
  switch (state.kind) {
    case "current":
      return [];
    case "pending":
      return [
        {
          severity: "error",
          message: `${slug} has ${state.pending} migrations not yet applied.`,
        },
      ];
    case "ahead":
      return [
        {
          severity: "warning",
          message: `${slug}: the database has ${state.unknown} migrations newer than this build.`,
        },
      ];
  }
};

const migrationProblems = (report: StatusReport): Problem[] =>
  report.migrations.status === "down" ? [] : report.migrations.value.flatMap(migrationProblem);

/** Everything on the report that needs a person's attention, most severe first. */
export const findProblems = (report: StatusReport): Problem[] =>
  [
    ...serviceProblems(report),
    ...scheduleProblems(report),
    ...queueProblems(report),
    ...migrationProblems(report),
  ].sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"));
