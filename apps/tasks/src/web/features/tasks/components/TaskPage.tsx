import { type FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import { DurationDays, type ProjectView, STATUSES, type Status, type Task } from "../../../../contract";
import { canDependOn, dayOfInstant, schedule } from "../../../../plan";
import { days, formatDay, STATUS_LABELS } from "../../../utils/format";
import { useAddDependency, useDeleteTask, useMoveTask, useRemoveDependency, useUpdateTask } from "../api/tasks";

const TaskForm = ({ task }: { task: Task }) => {
  const update = useUpdateTask();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [duration, setDuration] = useState(String(task.durationDays));
  const [startOn, setStartOn] = useState(task.startOn ?? "");
  const [dueOn, setDueOn] = useState(task.dueOn ?? "");

  const save = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({
      taskId: task.id,
      update: { title, notes, durationDays: Number(duration), startOn: startOn || null, dueOn: dueOn || null },
    });
  };

  return (
    <form className="task-form" onSubmit={save}>
      <label className="wide">
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
      </label>
      <label>
        Duration (days)
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          required
        />
      </label>
      <label>
        Not before
        <input type="date" value={startOn} onChange={(event) => setStartOn(event.target.value)} />
      </label>
      <label>
        Due
        <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
      </label>
      <label className="wide">
        Notes
        <textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="wide actions">
        <button type="submit" disabled={update.isPending || !DurationDays.safeParse(Number(duration)).success}>
          Save
        </button>
        {update.isSuccess && <span className="muted">Saved.</span>}
        {update.error && <span className="error">{update.error.message}</span>}
      </div>
    </form>
  );
};

const Dependencies = ({ project, task }: { project: ProjectView; task: Task }) => {
  const add = useAddDependency();
  const remove = useRemoveDependency();
  const byId = new Map(project.tasks.map((other) => [other.id, other]));
  const candidates = project.tasks.filter(
    (other) => !task.dependsOn.includes(other.id) && canDependOn(project.tasks, task.id, other.id),
  );
  const dependents = project.tasks.filter((other) => other.dependsOn.includes(task.id));

  return (
    <div className="dependencies">
      <section>
        <h2>Waits on</h2>
        <ul className="links">
          {task.dependsOn
            .flatMap((id) => byId.get(id) ?? [])
            .map((dependency) => (
              <li key={dependency.id}>
                <Link href={`/tasks/${dependency.id}`}>{dependency.title}</Link>
                <span className="muted">{STATUS_LABELS[dependency.status]}</span>
                <button
                  type="button"
                  className="remove"
                  aria-label={`Stop waiting on ${dependency.title}`}
                  onClick={() => remove.mutate({ taskId: task.id, dependsOnId: dependency.id })}
                >
                  ×
                </button>
              </li>
            ))}
        </ul>
        {candidates.length > 0 && (
          <select
            value=""
            aria-label="Add a task to wait on"
            onChange={(event) => add.mutate({ taskId: task.id, dependsOnId: event.target.value })}
          >
            <option value="">Wait on…</option>
            {candidates.map((other) => (
              <option key={other.id} value={other.id}>
                {other.title}
              </option>
            ))}
          </select>
        )}
        {(add.error ?? remove.error) && <p className="error">{(add.error ?? remove.error)?.message}</p>}
      </section>
      <section>
        <h2>Blocks</h2>
        {dependents.length === 0 && <p className="muted">Nothing waits on this.</p>}
        <ul className="links">
          {dependents.map((dependent) => (
            <li key={dependent.id}>
              <Link href={`/tasks/${dependent.id}`}>{dependent.title}</Link>
              <span className="muted">{STATUS_LABELS[dependent.status]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export const TaskPage = ({ project, taskId }: { project: ProjectView; taskId: string }) => {
  const move = useMoveTask(project.id);
  const remove = useDeleteTask();
  const [, navigate] = useLocation();
  const task = project.tasks.find((other) => other.id === taskId);

  if (task === undefined) {
    return <p className="muted">That task is gone.</p>;
  }
  const slot = schedule(project.tasks, dayOfInstant(new Date())).get(task.id);

  const confirmDelete = () => {
    if (confirm(`Delete "${task.title}"?`)) {
      remove.mutate(task.id, { onSuccess: () => navigate("/") });
    }
  };

  return (
    <section className="task-page">
      <div className="page-heading">
        <select
          value={task.status}
          aria-label="Status"
          onChange={(event) => move.mutate({ taskId: task.id, status: event.target.value as Status, beforeId: null })}
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {slot !== undefined && (
          <p className={slot.slack < 0 ? "error schedule" : "muted schedule"}>
            {task.status === "done" ? "Finished" : "Scheduled"} <time>{formatDay(slot.start)}</time>
            {slot.finish - slot.start > 1 && (
              <>
                {" – "}
                <time>{formatDay(slot.finish - 1)}</time>
              </>
            )}
            {task.status !== "done" &&
              (slot.slack < 0
                ? ` · ${days(-slot.slack)} late`
                : slot.critical
                  ? " · critical"
                  : ` · ${days(slot.slack)} to spare`)}
          </p>
        )}
        <button type="button" onClick={confirmDelete} disabled={remove.isPending}>
          Delete task
        </button>
      </div>
      {move.error && <p className="error">{move.error.message}</p>}
      <TaskForm task={task} />
      <Dependencies project={project} task={task} />
    </section>
  );
};
