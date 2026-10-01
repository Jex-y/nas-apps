import { useState } from "react";
import { useLocation } from "wouter";
import { type Exercise, Workout } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { tonnage } from "../../../../strength";
import { NumberField } from "../../../components/NumberField";
import { formatKg } from "../../../utils/format";
import { useWorkoutActions } from "../api/workouts";
import { lastSession } from "../utils/prefill";
import { EntryCard } from "./EntryCard";
import { ExercisePicker } from "./ExercisePicker";
import { RestTimer } from "./RestTimer";

type Props = {
  readonly workout: WorkoutDetail;
  readonly workouts: readonly WorkoutDetail[];
  readonly exercises: readonly Exercise[];
};

/** One workout, open to change whether it is under way or long finished. */
export const WorkoutEditor = ({ workout, workouts, exercises }: Props) => {
  const actions = useWorkoutActions();
  const [, navigate] = useLocation();
  const [notes, setNotes] = useState(workout.notes);

  const open = workout.finishedAt === null;
  const sets = workout.entries.flatMap((entry) => entry.sets);
  const lastLogged = sets.reduce<string | null>(
    (latest, set) => (latest === null || set.loggedAt > latest ? set.loggedAt : latest),
    null,
  );

  return (
    <>
      <div className="page-heading">
        <input
          type="date"
          value={workout.date}
          aria-label="Training day"
          onChange={(event) => event.target.value !== "" && actions.update(workout, { date: event.target.value })}
        />
        {open && lastLogged !== null && <RestTimer since={lastLogged} />}
        <div className="actions">
          <button
            type="button"
            className={open ? "primary" : undefined}
            onClick={() => actions.update(workout, { finishedAt: open ? new Date().toISOString() : null })}
          >
            {open ? "Finish" : "Reopen"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm("Delete this workout and everything logged in it?")) {
                actions.remove(workout);
                navigate("/history");
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {workout.entries.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          lastTime={lastSession(workouts, workout, entry.exerciseId)}
          actions={actions}
        />
      ))}
      <ExercisePicker exercises={exercises} onPick={(exerciseId) => actions.addEntry(workout, exerciseId)} />

      <section className="card workout-meta">
        <div className="field">
          <span className="label">Bodyweight</span>
          <NumberField
            value={workout.bodyweightKg}
            schema={Workout.shape.bodyweightKg.unwrap()}
            label="Bodyweight in kilograms"
            inputMode="decimal"
            placeholder="kg"
            onCommit={(bodyweightKg) => actions.update(workout, { bodyweightKg })}
          />
        </div>
        <p className="muted numeric">{formatKg(tonnage(sets))} kg lifted</p>
        <textarea
          rows={2}
          value={notes}
          placeholder="Notes on the session"
          aria-label="Notes on the session"
          maxLength={10_000}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => notes !== workout.notes && actions.update(workout, { notes })}
        />
      </section>
    </>
  );
};
