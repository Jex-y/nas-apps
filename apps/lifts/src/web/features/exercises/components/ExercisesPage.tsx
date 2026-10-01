import { type FormEvent, useState } from "react";
import { Link } from "wouter";
import { COMPETITION_LIFTS, type CompetitionLift, type Exercise } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { formatDay, formatKg } from "../../../utils/format";
import { useExerciseActions } from "../api/exercises";
import { LIFT_NAMES, missingLifts, standings, summarise } from "../utils/lifts";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly WorkoutDetail[];
};

const byName = (a: Exercise, b: Exercise) => a.name.localeCompare(b.name);

export const ExercisesPage = ({ exercises, workouts }: Props) => {
  const actions = useExerciseActions();
  const [name, setName] = useState("");
  const [lift, setLift] = useState<CompetitionLift | "">("");

  const summaries = summarise(exercises.toSorted(byName), workouts);
  const { lifts, totalKg } = standings(summaries);
  const free = missingLifts(exercises);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    actions.create(name.trim(), lift === "" ? null : lift);
    setName("");
    setLift("");
  };

  return (
    <>
      <dl className="standings">
        {lifts.map(({ lift: each, maxKg }) => (
          <div key={each} className="card">
            <dt className="label">{LIFT_NAMES[each]}</dt>
            <dd className="numeric">{maxKg === null ? "–" : formatKg(maxKg)}</dd>
          </div>
        ))}
        <div className="card">
          <dt className="label">Total</dt>
          <dd className="numeric">{totalKg === null ? "–" : formatKg(totalKg)}</dd>
        </div>
      </dl>
      <p className="muted">Estimated one-rep maxes in kilograms, from the best work set logged.</p>

      <h2>Exercises</h2>
      {summaries.length > 0 && (
        <ul className="card rows">
          {summaries.map(({ exercise, sessions, lastTrainedOn, bestMaxKg }) => (
            <li key={exercise.id}>
              <Link href={`/exercises/${exercise.id}`} className="row-title">
                {exercise.name}
                {exercise.lift !== null && <span className="badge">{exercise.lift}</span>}
                <span className="trailing numeric">{bestMaxKg === null ? "" : `${formatKg(bestMaxKg)} kg`}</span>
              </Link>
              <p className="muted">
                {lastTrainedOn === null
                  ? "Not logged yet"
                  : `${sessions === 1 ? "1 session" : `${sessions} sessions`}, last on ${formatDay(lastTrainedOn)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      <form className="inline-form" onSubmit={submit}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New exercise"
          aria-label="Exercise name"
          maxLength={100}
          required
        />
        <select
          value={lift}
          aria-label="Competition lift"
          onChange={(event) => setLift(COMPETITION_LIFTS.find((each) => each === event.target.value) ?? "")}
        >
          <option value="">Not a competition lift</option>
          {free.map((each) => (
            <option key={each} value={each}>
              {LIFT_NAMES[each]}
            </option>
          ))}
        </select>
        <button type="submit" disabled={name.trim() === ""}>
          Add
        </button>
      </form>
    </>
  );
};
