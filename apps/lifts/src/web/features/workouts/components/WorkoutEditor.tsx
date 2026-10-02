import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { type Exercise, Workout } from "../../../../contract";
import { sessionsOf, type WorkoutDetail } from "../../../../log";
import { bestEstimate, isRecord, isWorkSet, tonnage } from "../../../../strength";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { formatDay, formatKg } from "../../../utils/format";
import { useWorkoutActions } from "../api/workouts";
import { lastSession } from "../utils/plan";
import { EntryCard } from "./EntryCard";
import { ExerciseSheet } from "./ExerciseSheet";
import { RatingBar } from "./RatingBar";
import { RestTimer } from "./RestTimer";

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
  const [picking, setPicking] = useState(false);
  const [ratingId, setRatingId] = useState<string | null>(null);
  const stopAsking = useCallback(() => setRatingId(null), []);
  const [notes, setNotes] = useState(workout.notes);
  const [bodyweight, setBodyweight] = useState(workout.bodyweightKg === null ? "" : String(workout.bodyweightKg));

  const underWay = workout.finishedAt === null;
  const rated = workout.entries.flatMap((entry) =>
    entry.sets.filter((set) => set.id === ratingId).map((set) => ({ set, exercise: entry.exercise.name })),
  )[0];
  const others = workouts.filter((other) => other.id !== workout.id && other.date <= workout.date);
  const sets = workout.entries.flatMap((entry) => entry.sets);
  const lastLogged = sets.reduce<string | null>(
    (latest, set) => (latest === null || set.loggedAt > latest ? set.loggedAt : latest),
    null,
  );
  const before = (exerciseId: string) => sessionsOf(others, exerciseId).flatMap((session) => session.sets);
  const records = workout.entries.flatMap((entry) => {
    const best = bestEstimate(entry.sets);
    return best !== null && isRecord(best.set, before(entry.exerciseId))
      ? [{ id: entry.id, name: entry.exercise.name, maxKg: best.maxKg }]
      : [];
  });
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
      <div className={underWay ? "session-bar" : "session-bar finished"}>
        <label className="session-day">
          <span className="label">{underWay ? "Under way" : "Finished"}</span>
          <strong>{formatDay(workout.date)}</strong>
          <input
            type="date"
            value={workout.date}
            aria-label="Training day"
            onChange={(event) => event.target.value !== "" && actions.update(workout, { date: event.target.value })}
          />
        </label>
        {underWay && <RestTimer since={lastLogged} />}
        <button
          type="button"
          className={underWay ? "primary" : undefined}
          onClick={() => {
            if (underWay) {
              actions.finish(workout);
            } else {
              actions.update(workout, { finishedAt: null });
            }
            navigate(underWay ? `/workouts/${workout.id}` : "/");
          }}
        >
          {underWay ? "Finish" : "Reopen"}
        </button>
      </div>

      {!underWay && records.length > 0 && (
        <ul className="card records-made">
          {records.map((record) => (
            <li key={record.id}>
              <span className="pr">PR</span>
              <span>{record.name}</span>
              <span className="numeric">
                {formatKg(record.maxKg)}
                <small>kg est. max</small>
              </span>
            </li>
          ))}
        </ul>
      )}

      {workout.entries.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          lastTime={lastSession(workouts, workout, entry.exerciseId)}
          before={before(entry.exerciseId)}
          underWay={underWay}
          ratingId={ratingId}
          onAsk={setRatingId}
          actions={actions}
        />
      ))}
      {rated !== undefined && (
        <RatingBar
          key={rated.set.id}
          set={rated.set}
          exercise={rated.exercise}
          onClose={stopAsking}
          onRate={(rpe) => {
            actions.updateSet(rated.set, { rpe });
            setRatingId(null);
          }}
        />
      )}

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
            actions.addEntry(workout, exerciseId);
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
            navigate(underWay ? "/" : "/history");
          }}
        >
          Delete workout
        </ConfirmButton>
      </section>
    </>
  );
};
