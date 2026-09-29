import { Link } from "wouter";
import type { Task, TaskList } from "../../../../contract";
import { blockers, depths, topologicalOrder } from "../../../../plan";
import { useMoveTask } from "../api/tasks";
import { NewTaskForm } from "./NewTaskForm";
import { TaskMeta } from "./TaskMeta";

const TaskRow = ({ task, byId }: { task: Task; byId: ReadonlyMap<string, Task> }) => {
  const move = useMoveTask();
  const done = task.status === "done";
  const waiting = blockers(task, byId);

  return (
    <li className={done ? "task-row done" : "task-row"}>
      <input
        type="checkbox"
        checked={done}
        disabled={!done && waiting.length > 0}
        aria-label={done ? `Reopen ${task.title}` : `Finish ${task.title}`}
        onChange={() => move.mutate({ taskId: task.id, status: done ? "todo" : "done", beforeId: null })}
      />
      <div>
        <Link href={`/task/${task.id}`} className="task-title">
          {task.title}
        </Link>
        <TaskMeta task={task} byId={byId} />
        {task.dependsOn.length > 0 && (
          <p className="muted after">
            After{" "}
            {task.dependsOn
              .flatMap((id) => byId.get(id) ?? [])
              .map((dependency) => dependency.title)
              .join(", ")}
          </p>
        )}
        {move.error && <p className="error">{move.error.message}</p>}
      </div>
    </li>
  );
};

/** The graph as stages: every task waits only on tasks in earlier stages, so a stage's tasks can run side by side. */
export const ListPage = ({ tasks }: { tasks: TaskList }) => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depth = depths(tasks);
  const stages = Map.groupBy(topologicalOrder(tasks), (task) => depth.get(task.id) ?? 0);

  return (
    <section>
      <NewTaskForm />
      {tasks.length === 0 && <p className="muted">No tasks yet. Add one, then open it to set what it waits on.</p>}
      {[...stages].map(([stage, tasks]) => (
        <section key={stage} className="stage">
          <h2>
            Stage {stage + 1}{" "}
            <span className="muted numeric">
              {tasks.filter((task) => task.status === "done").length}/{tasks.length}
            </span>
          </h2>
          <ul className="task-list">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} byId={byId} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
};
