import { useState } from "react";
import { Link, useLocation } from "wouter";
import { COMPETITION_LIFTS, type Exercise } from "../../../../contract";
import { sessionsOf, type WorkoutDetail } from "../../../../log";
import { repRecords } from "../../../../strength";
import { formatDay, formatKg, formatSet } from "../../../utils/format";
import { useExerciseActions } from "../api/exercises";
import { trend } from "../utils/chart";
import { LIFT_NAMES } from "../utils/lifts";
import { MaxChart } from "./MaxChart";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly WorkoutDetail[];
  readonly exerciseId: string;
};

const History = ({
  exercise,
  workouts,
}: {
  readonly exercise: Exercise;
  readonly workouts: readonly WorkoutDetail[];
}) => {
  const sessions = sessionsOf(workouts, exercise.id);
  const points = trend(sessions);
  const dateOf = new Map(sessions.flatMap(({ workout, sets }) => sets.map((set) => [set.id, workout.date] as const)));
  const records = repRecords(sessions.flatMap((session) => session.sets));

  if (sessions.length === 0) {
    return <p className="muted">Not logged yet.</p>;
  }
  return (
    <>
      {points.length > 1 && (
        <section className="card">
          <h2>Estimated max</h2>
          <MaxChart points={points} />
        </section>
      )}
      {records.length > 0 && (
        <section className="card">
          <h2>Rep records</h2>
          <table className="records">
            <thead>
              <tr>
                <th scope="col">Reps</th>
                <th scope="col">Weight</th>
                <th scope="col">Set on</th>
              </tr>
            </thead>
            <tbody>
              {records.map(({ reps, set }) => (
                <tr key={reps}>
                  <td className="numeric">{reps}</td>
                  <td className="numeric">{formatKg(set.weightKg)} kg</td>
                  <td>{formatDay(dateOf.get(set.id) ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <h2>Sessions</h2>
      <ul className="card rows">
        {sessions.toReversed().map(({ workout, sets }) => (
          <li key={workout.id}>
            <Link href={`/workouts/${workout.id}`} className="row-title">
              <time dateTime={workout.date}>{formatDay(workout.date)}</time>
            </Link>
            <p className="muted numeric">{sets.map(formatSet).join(" · ")}</p>
          </li>
        ))}
      </ul>
    </>
  );
};

export const ExercisePage = ({ exercises, workouts, exerciseId }: Props) => {
  const actions = useExerciseActions();
  const [, navigate] = useLocation();
  const exercise = exercises.find((other) => other.id === exerciseId);
  const [name, setName] = useState(exercise?.name ?? "");

  if (exercise === undefined) {
    return (
      <p className="muted">
        That exercise is not in the log. <Link href="/exercises">Back to exercises</Link>
      </p>
    );
  }
  const taken = (lift: Exercise["lift"]) => exercises.some((other) => other.lift === lift && other.id !== exercise.id);
  const logged = sessionsOf(workouts, exercise.id).length > 0;
  const rename = () => {
    const next = name.trim();
    if (next === "") {
      setName(exercise.name);
    } else if (next !== exercise.name) {
      actions.update(exercise, { name: next });
    }
  };

  return (
    <>
      <div className="page-heading">
        <input
          className="title"
          value={name}
          aria-label="Exercise name"
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          onBlur={rename}
        />
        <div className="actions">
          <select
            value={exercise.lift ?? ""}
            aria-label="Competition lift"
            onChange={(event) =>
              actions.update(exercise, { lift: COMPETITION_LIFTS.find((each) => each === event.target.value) ?? null })
            }
          >
            <option value="">Not a competition lift</option>
            {COMPETITION_LIFTS.filter((lift) => !taken(lift)).map((lift) => (
              <option key={lift} value={lift}>
                {LIFT_NAMES[lift]}
              </option>
            ))}
          </select>
          {!logged && (
            <button
              type="button"
              onClick={() => {
                actions.remove(exercise);
                navigate("/exercises");
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <History exercise={exercise} workouts={workouts} />
    </>
  );
};
