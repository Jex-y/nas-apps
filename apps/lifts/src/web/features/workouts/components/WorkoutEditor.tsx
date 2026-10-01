import { useState } from "react";
import { useLocation } from "wouter";
import { type Exercise, Workout } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { isWorkSet, tonnage } from "../../../../strength";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { formatDay, formatKg } from "../../../utils/format";
import { useWorkoutActions } from "../api/workouts";
import { lastSession } from "../utils/prefill";
import { EntryCard } from "./EntryCard";
import { ExerciseSheet } from "./ExerciseSheet";

type Props = {
  readonly workout: WorkoutDetail;
  readonly workouts: readonly WorkoutDetail[];
  readonly exercises: readonly Exercise[];
};

const Bodyweight = Workout.shape.bodyweightKg.unwrap();

/** One workout, open to change whether it is under way or long finished. */
export const WorkoutEditor = ({ workout, workouts, exercises }: Props) => {
  const actions = useWorkoutActions();
  const [, navigate] = useLocation();
  const [activeId, setActiveId] = useState(workout.entries.at(-1)?.id ?? null);
  const [picking, setPicking] = useState(false);
  const [notes, setNotes] = useState(workout.notes);
  const [bodyweight, setBodyweight] = useState(workout.bodyweightKg === null ? "" : String(workout.bodyweightKg));

  const open = workout.finishedAt === null;
  const sets = workout.entries.flatMap((entry) => entry.sets);
  const lastLogged = sets.reduce<string | null>(
    (latest, set) => (latest === null || set.loggedAt > latest ? set.loggedAt : latest),
    null,
  );
  const saveBodyweight = () => {
    const typed = bodyweight.trim().replace(",", ".");
    const parsed = typed === "" ? null : Bodyweight.safeParse(Number(typed));
    if (parsed !== null && !parsed.success) {
      setBodyweight(workout.bodyweightKg === null ? "" : String(workout.bodyweightKg));
    } else if ((parsed?.data ?? null) !== workout.bodyweightKg) {
      actions.update(workout, { bodyweightKg: parsed?.data ?? null });
    }
  };

  return (
    <>
      <div className="session-bar">
        <label className="session-day">
          <span className="label">{open ? "Session under way" : "Session"}</span>
          <strong>{formatDay(workout.date)}</strong>
          <input
            type="date"
            value={workout.date}
            aria-label="Training day"
            onChange={(event) => event.target.value !== "" && actions.update(workout, { date: event.target.value })}
          />
        </label>
        <button
          type="button"
          className={open ? "primary" : undefined}
          onClick={() => actions.update(workout, { finishedAt: open ? new Date().toISOString() : null })}
        >
          {open ? "Finish" : "Reopen"}
        </button>
      </div>

      {workout.entries.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          lastTime={lastSession(workouts, workout, entry.exerciseId)}
          active={entry.id === activeId}
          onActivate={() => setActiveId(entry.id)}
          restingSince={open ? lastLogged : null}
          actions={actions}
        />
      ))}

      <button type="button" className="add-exercise" onClick={() => setPicking(true)}>
        <Icon name="plus" />
        {workout.entries.length === 0 ? "Add your first exercise" : "Add exercise"}
      </button>
      {picking && (
        <ExerciseSheet
          exercises={exercises}
          workouts={workouts}
          onClose={() => setPicking(false)}
          onPick={(exerciseId) => {
            setActiveId(actions.addEntry(workout, exerciseId));
            setPicking(false);
          }}
        />
      )}

      <section className="card session-meta">
        <dl className="tallies">
          <div>
            <dt className="label">Work sets</dt>
            <dd className="numeric">{sets.filter(isWorkSet).length}</dd>
          </div>
          <div>
            <dt className="label">Lifted</dt>
            <dd className="numeric">
              {formatKg(tonnage(sets))}
              <small>kg</small>
            </dd>
          </div>
          <div>
            <dt className="label">Bodyweight</dt>
            <dd>
              <input
                className="numeric"
                inputMode="decimal"
                value={bodyweight}
                placeholder="–"
                aria-label="Bodyweight in kilograms"
                onChange={(event) => setBodyweight(event.target.value)}
                onBlur={saveBodyweight}
              />
              <small>kg</small>
            </dd>
          </div>
        </dl>
        <textarea
          rows={2}
          value={notes}
          placeholder="Notes on the session"
          aria-label="Notes on the session"
          maxLength={10_000}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => notes !== workout.notes && actions.update(workout, { notes })}
        />
        <ConfirmButton
          className="quiet-link"
          confirm="Delete the whole workout?"
          onConfirm={() => {
            actions.remove(workout);
            navigate(open ? "/" : "/history");
          }}
        >
          Delete workout
        </ConfirmButton>
      </section>
    </>
  );
};
