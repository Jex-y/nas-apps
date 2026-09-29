import type { Task } from "../../../../contract";
import { blockers } from "../../../../plan";
import { days, formatDate, STATUS_LABELS } from "../../../utils/format";

/** The facts shown on every card and list row: state, estimate, due date and what it waits on. */
export const TaskMeta = ({ task, byId }: { task: Task; byId: ReadonlyMap<string, Task> }) => {
  const waiting = task.status === "done" ? [] : blockers(task, byId);
  return (
    <ul className="meta">
      {task.status === "doing" && <li className="badge doing">{STATUS_LABELS.doing}</li>}
      {waiting.length > 0 ? (
        <li className="badge blocked" title={waiting.map((dependency) => dependency.title).join(", ")}>
          Waiting on {waiting.length}
        </li>
      ) : (
        task.status === "todo" && <li className="badge ready">Ready</li>
      )}
      <li className="numeric">{days(task.durationDays)}</li>
      {task.dueOn !== null && <li className="numeric">Due {formatDate(task.dueOn)}</li>}
    </ul>
  );
};
