import { type DragEvent, useState } from "react";
import { Link } from "wouter";
import { STATUSES, type Status, type Task, type TaskList } from "../../../../contract";
import { blockers } from "../../../../plan";
import { STATUS_LABELS } from "../../../utils/format";
import { useMoveTask } from "../../tasks/api/tasks";
import { NewTaskForm } from "../../tasks/components/NewTaskForm";
import { TaskMeta } from "../../tasks/components/TaskMeta";

type Target = { readonly status: Status; readonly beforeId: string | null };

/**
 * Cards drag between and within columns on a pointer; on touch, where HTML drag and drop is unreliable, each card's
 * menu moves it to the bottom of another column. A task still waiting on others cannot leave To do.
 */
export const BoardPage = ({ tasks }: { tasks: TaskList }) => {
  const move = useMoveTask();
  const [dragging, setDragging] = useState<Task | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const byId = new Map(tasks.map((task) => [task.id, task]));

  const canEnter = (task: Task, status: Status) => status === "todo" || blockers(task, byId).length === 0;

  const over = (event: DragEvent, next: Target) => {
    event.stopPropagation();
    if (dragging === null || !canEnter(dragging, next.status)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (target?.status !== next.status || target.beforeId !== next.beforeId) {
      setTarget(next);
    }
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    if (dragging !== null && target !== null && target.beforeId !== dragging.id) {
      move.mutate({ taskId: dragging.id, ...target });
    }
    setDragging(null);
    setTarget(null);
  };

  return (
    <section>
      <NewTaskForm />
      {move.error && <p className="error">{move.error.message}</p>}
      <div className="board">
        {STATUSES.map((status) => {
          const column = tasks.filter((task) => task.status === status);
          const endTarget = target?.status === status && target.beforeId === null;
          return (
            <section
              key={status}
              aria-label={STATUS_LABELS[status]}
              className={endTarget ? "column drop-end" : "column"}
              onDragOver={(event) => over(event, { status, beforeId: null })}
              onDrop={drop}
            >
              <h2>
                {STATUS_LABELS[status]} <span className="muted numeric">{column.length}</span>
              </h2>
              {column.map((task) => (
                <article
                  key={task.id}
                  className={[
                    "card",
                    dragging?.id === task.id && "dragging",
                    target?.beforeId === task.id && "drop-before",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", task.id);
                    setDragging(task);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setTarget(null);
                  }}
                  onDragOver={(event) => over(event, { status, beforeId: task.id })}
                  onDrop={drop}
                >
                  <Link href={`/task/${task.id}`} className="task-title" draggable={false}>
                    {task.title}
                  </Link>
                  <TaskMeta task={task} byId={byId} />
                  <select
                    value={task.status}
                    aria-label={`Move ${task.title}`}
                    onChange={(event) =>
                      move.mutate({ taskId: task.id, status: event.target.value as Status, beforeId: null })
                    }
                  >
                    {STATUSES.map((option) => (
                      <option key={option} value={option} disabled={!canEnter(task, option)}>
                        {STATUS_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </section>
  );
};
