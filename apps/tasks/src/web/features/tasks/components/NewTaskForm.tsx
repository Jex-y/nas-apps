import { type FormEvent, useState } from "react";
import { DurationDays } from "../../../../contract";
import { useCreateTask } from "../api/tasks";

export const NewTaskForm = ({ projectId }: { projectId: string }) => {
  const create = useCreateTask(projectId);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("1");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ title, durationDays: Number(duration) }, { onSuccess: () => setTitle("") });
  };

  return (
    <form className="inline-form new-task" onSubmit={submit}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="New task"
        aria-label="Task title"
        maxLength={200}
        required
      />
      <label className="duration">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          aria-label="Duration in days"
          required
        />
        days
      </label>
      <button type="submit" disabled={create.isPending || !DurationDays.safeParse(Number(duration)).success}>
        Add
      </button>
      {create.error && <span className="error">{create.error.message}</span>}
    </form>
  );
};
