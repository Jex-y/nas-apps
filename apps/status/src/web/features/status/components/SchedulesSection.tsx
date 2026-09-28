import type { ScheduleStatus, StatusReport } from "../../../../contract";
import { formatDateTime, formatDuration, formatRelative } from "../utils/format";
import { ProbeView } from "./Primitives";

const NextRun = ({ schedule, generatedAt }: { readonly schedule: ScheduleStatus; readonly generatedAt: string }) => {
  switch (schedule.next.kind) {
    case "scheduled":
      return (
        <span title={formatDateTime(schedule.next.runAt)}>Next {formatRelative(schedule.next.runAt, generatedAt)}</span>
      );
    case "overdue":
      return (
        <span className="error">
          Overdue: the slot that started {formatRelative(schedule.next.slotStartedAt, generatedAt)} was never enqueued
        </span>
      );
  }
};

export const SchedulesSection = ({ report }: { readonly report: StatusReport }) => (
  <section>
    <h2>Schedules</h2>
    <ProbeView probe={report.schedules}>
      {(schedules) =>
        schedules.length === 0 ? (
          <p className="muted">No app registers a schedule.</p>
        ) : (
          <ul className="cards">
            {schedules.map((schedule) => (
              <li key={schedule.name} className="card">
                <h3>
                  <code>{schedule.name}</code>
                </h3>
                <p className="muted">
                  Every <span className="figure">{formatDuration(schedule.everyMs)}</span>
                  {schedule.jitterMs > 0 && (
                    <>
                      , up to <span className="figure">{formatDuration(schedule.jitterMs)}</span> late
                    </>
                  )}
                </p>
                <p>
                  {schedule.lastEnqueued === null ? (
                    "Never enqueued"
                  ) : (
                    <span title={formatDateTime(schedule.lastEnqueued.runAt)}>
                      Last due {formatRelative(schedule.lastEnqueued.runAt, report.generatedAt)}
                    </span>
                  )}
                  {" · "}
                  <NextRun schedule={schedule} generatedAt={report.generatedAt} />
                </p>
              </li>
            ))}
          </ul>
        )
      }
    </ProbeView>
  </section>
);
