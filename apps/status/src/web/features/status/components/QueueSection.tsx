import type { JobSummary, Outcomes, StatusReport } from "../../../../contract";
import { ageOf, formatCount, formatDuration } from "../utils/format";
import { STALE_READY_MS } from "../utils/problems";
import { Fact, ProbeView } from "./Primitives";
import { ThroughputChart } from "./ThroughputChart";

const sumOutcomes = (jobs: readonly JobSummary[]): Outcomes =>
  jobs.reduce(
    (sum, job) => ({
      completed: sum.completed + job.last24h.completed,
      retrying: sum.retrying + job.last24h.retrying,
      dead: sum.dead + job.last24h.dead,
    }),
    { completed: 0, retrying: 0, dead: 0 },
  );

const JobCard = ({ job, generatedAt }: { readonly job: JobSummary; readonly generatedAt: string }) => {
  const waitedMs = job.oldestReadyAt === null ? null : ageOf(job.oldestReadyAt, generatedAt);
  return (
    <li className="card">
      <h3>
        <code>{job.name}</code>
        {!job.registered && <span className="tag warning">no handler</span>}
      </h3>
      <dl className="facts row">
        <Fact label="Running">{formatCount(job.running)}</Fact>
        <Fact label="Ready">{formatCount(job.ready)}</Fact>
        <Fact label="Waiting">{formatCount(job.waiting)}</Fact>
        <Fact label="Retrying">{formatCount(job.retrying)}</Fact>
        <Fact label="Dead">
          <span className={job.dead > 0 ? "warning-text" : undefined}>{formatCount(job.dead)}</span>
        </Fact>
      </dl>
      <p className="muted">
        24 h: <span className="figure">{formatCount(job.last24h.completed)}</span> completed,{" "}
        <span className="figure">{formatCount(job.last24h.retrying)}</span> retried,{" "}
        <span className="figure">{formatCount(job.last24h.dead)}</span> died
        {waitedMs !== null && (
          <>
            {" · "}
            <span className={waitedMs > STALE_READY_MS ? "error" : undefined}>
              oldest ready for <span className="figure">{formatDuration(waitedMs)}</span>
            </span>
          </>
        )}
      </p>
    </li>
  );
};

export const QueueSection = ({ report }: { readonly report: StatusReport }) => (
  <section>
    <h2>Job queue</h2>
    <ProbeView probe={report.queue}>
      {(queue) => {
        const totals = sumOutcomes(queue.jobs);
        return (
          <>
            <p className="muted">
              Last 24 h: <span className="figure">{formatCount(totals.completed)}</span> completed,{" "}
              <span className="figure">{formatCount(totals.retrying)}</span> retried,{" "}
              <span className="figure">{formatCount(totals.dead)}</span> died.
            </p>
            <ThroughputChart hourly={queue.hourly} />
            {queue.jobs.length === 0 ? (
              <p className="muted">No jobs are registered or queued.</p>
            ) : (
              <ul className="cards">
                {queue.jobs.map((job) => (
                  <JobCard key={job.name} job={job} generatedAt={report.generatedAt} />
                ))}
              </ul>
            )}
          </>
        );
      }}
    </ProbeView>
  </section>
);
