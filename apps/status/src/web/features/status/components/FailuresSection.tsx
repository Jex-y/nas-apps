import type { JobFailure, StatusReport } from "../../../../contract";
import { firstLine, formatRelative } from "../utils/format";
import { ProbeView } from "./Primitives";

const FailureItem = ({ failure, generatedAt }: { readonly failure: JobFailure; readonly generatedAt: string }) => {
  const summary = firstLine(failure.error);
  return (
    <li className="card">
      <h3>
        <code>{failure.name}</code>
        <span className={failure.state === "dead" ? "tag error" : "tag warning"}>{failure.state}</span>
      </h3>
      <p className="muted">
        Attempt{" "}
        <span className="figure">
          {failure.attempts}/{failure.maxAttempts}
        </span>
        {failure.failedAt !== null && <> failed {formatRelative(failure.failedAt, generatedAt)}</>}
        {failure.state === "retrying" && <>; next attempt {formatRelative(failure.nextAttemptAt, generatedAt)}</>}
      </p>
      <p className="failure-message">{summary}</p>
      {summary !== failure.error && (
        <details>
          <summary className="muted">Full error</summary>
          <pre>{failure.error}</pre>
        </details>
      )}
    </li>
  );
};

export const FailuresSection = ({ report }: { readonly report: StatusReport }) => (
  <section>
    <h2>Recent failures</h2>
    <ProbeView probe={report.queue}>
      {(queue) =>
        queue.recentFailures.length === 0 ? (
          <p className="muted">No failed jobs are waiting to retry or kept as dead.</p>
        ) : (
          <ul className="cards">
            {queue.recentFailures.map((failure) => (
              <FailureItem key={failure.id} failure={failure} generatedAt={report.generatedAt} />
            ))}
          </ul>
        )
      }
    </ProbeView>
  </section>
);
