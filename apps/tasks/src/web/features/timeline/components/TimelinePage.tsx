import { Link } from "wouter";
import type { TaskList } from "../../../../contract";
import { type Day, dateOfDay, dayOfDate, dayOfInstant, schedule, topologicalOrder } from "../../../../plan";
import { days, formatDay, STATUS_LABELS } from "../../../utils/format";

const DAY_WIDTH = 28;
const ROW = 36;
const HEADER = 44;
const BAR_INSET = 9;

const month = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const weekday = (day: Day) => new Date(dateOfDay(day)).getUTCDay();
const dayOfMonth = (day: Day) => new Date(dateOfDay(day)).getUTCDate();

/**
 * A Gantt chart of the critical-path schedule: one row per task, earliest first, with an elbow from each
 * dependency's finish to the start of the task waiting on it.
 */
export const TimelinePage = ({ tasks }: { tasks: TaskList }) => {
  if (tasks.length === 0) {
    return <p className="muted">Add tasks to see them scheduled.</p>;
  }

  const today = dayOfInstant(new Date());
  const slots = schedule(tasks, today);
  const slotOf = (id: string) => slots.get(id) ?? { start: today, finish: today + 1, slack: 0, critical: false };
  const rows = topologicalOrder(tasks).toSorted((a, b) => slotOf(a.id).start - slotOf(b.id).start);
  const rowOf = new Map(rows.map((task, index) => [task.id, index]));

  const all = [...slots.values()];
  const dues = tasks.flatMap((task) => (task.dueOn === null ? [] : [dayOfDate(task.dueOn) + 1]));
  const from = Math.min(today, ...all.map((slot) => slot.start)) - 1;
  const to = Math.max(today + 1, ...all.map((slot) => slot.finish), ...dues) + 2;
  const end = Math.max(...tasks.filter((task) => task.status !== "done").map((task) => slotOf(task.id).finish));
  const late = Math.min(0, ...tasks.filter((task) => task.status !== "done").map((task) => slotOf(task.id).slack));

  const x = (day: Day) => (day - from) * DAY_WIDTH;
  const y = (row: number) => HEADER + row * ROW;
  const width = x(to);
  const height = y(rows.length);
  const columns = Array.from({ length: to - from }, (_, index) => from + index);

  return (
    <section>
      <p className="muted summary">
        {Number.isFinite(end) ? (
          <>
            Everything done by <time>{formatDay(end - 1)}</time>
            {late < 0 && <span className="error"> · {days(-late)} behind a due date</span>}
          </>
        ) : (
          "Everything is done."
        )}
      </p>
      <ul className="legend">
        {(["todo", "doing", "done"] as const).map((status) => (
          <li key={status}>
            <span className={`swatch ${status}`} /> {STATUS_LABELS[status]}
          </li>
        ))}
        <li>
          <span className="swatch critical" /> Critical path
        </li>
        <li>
          <span className="swatch due" /> Due
        </li>
        <li>
          <span className="swatch today" /> Today
        </li>
      </ul>

      <div className="gantt">
        <ol className="gantt-labels" style={{ paddingTop: HEADER }}>
          {rows.map((task) => (
            <li key={task.id} style={{ height: ROW }} className={slotOf(task.id).critical ? "critical" : undefined}>
              <Link href={`/task/${task.id}`}>{task.title}</Link>
            </li>
          ))}
        </ol>
        <svg className="gantt-chart" width={width} height={height} role="img" aria-label="Timeline">
          <defs>
            <marker id="arrow" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0L6 3L0 6z" className="arrowhead" />
            </marker>
          </defs>

          {columns.map((day) => (
            <g key={day}>
              {(weekday(day) === 0 || weekday(day) === 6) && (
                <rect className="weekend" x={x(day)} y={HEADER} width={DAY_WIDTH} height={height - HEADER} />
              )}
              {(dayOfMonth(day) === 1 || day === from) && (
                <text className="month" x={x(day) + 4} y={16}>
                  {month.format(new Date(dateOfDay(day)))}
                </text>
              )}
              <text className="day" x={x(day) + DAY_WIDTH / 2} y={HEADER - 10}>
                {dayOfMonth(day)}
              </text>
            </g>
          ))}
          {rows.map((task, row) => (
            <line key={task.id} className="grid" x1={0} x2={width} y1={y(row + 1)} y2={y(row + 1)} />
          ))}
          <line className="today" x1={x(today)} x2={x(today)} y1={HEADER - 6} y2={height} />

          {rows.flatMap((task, row) =>
            task.dependsOn.flatMap((id) => {
              const dependencyRow = rowOf.get(id);
              if (dependencyRow === undefined) {
                return [];
              }
              const x1 = x(slotOf(id).finish);
              const x2 = x(slotOf(task.id).start) + 2;
              const bend = Math.min(x1 + 8, x2 - 6);
              return [
                <path
                  key={`${id}-${task.id}`}
                  className="link"
                  d={`M${x1} ${y(dependencyRow) + ROW / 2}H${bend}V${y(row) + ROW / 2}H${x2}`}
                  markerEnd="url(#arrow)"
                />,
              ];
            }),
          )}

          {rows.map((task, row) => {
            const slot = slotOf(task.id);
            const due = task.dueOn === null ? null : dayOfDate(task.dueOn);
            const summary = [
              task.title,
              `${formatDay(slot.start)} – ${formatDay(slot.finish - 1)}`,
              days(slot.finish - slot.start),
              STATUS_LABELS[task.status],
              task.status === "done"
                ? null
                : slot.slack < 0
                  ? `${days(-slot.slack)} late`
                  : `${days(slot.slack)} slack`,
            ];
            return (
              <g key={task.id}>
                <rect
                  className={`bar ${task.status}${slot.critical ? " critical" : ""}`}
                  x={x(slot.start) + 2}
                  y={y(row) + BAR_INSET}
                  width={Math.max(x(slot.finish) - x(slot.start) - 4, 4)}
                  height={ROW - 2 * BAR_INSET}
                >
                  <title>{summary.filter(Boolean).join(" · ")}</title>
                </rect>
                {due !== null && (
                  <path className="due" d={`M${x(due + 1)} ${y(row) + 4}v${ROW - 8}`}>
                    <title>Due {formatDay(due)}</title>
                  </path>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
};
