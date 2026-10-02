import type { Exercise } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { formatDay, formatLongDay, localToday } from "../../../utils/format";
import { Standings } from "../../exercises/components/Standings";
import { useWorkoutActions } from "../api/workouts";
import { startingPoints } from "../utils/plan";
import { WorkoutEditor } from "./WorkoutEditor";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly WorkoutDetail[];
};

/** How many past line-ups are offered to start from. */
const STARTING_POINTS = 4;

/** The session under way, or the ways into a new one. */
export const LogPage = ({ exercises, workouts }: Props) => {
  const actions = useWorkoutActions();
  const underWay = workouts.findLast((workout) => workout.finishedAt === null);

  if (underWay !== undefined) {
    return <WorkoutEditor key={underWay.id} workout={underWay} workouts={workouts} exercises={exercises} />;
  }
  // The line-up trained longest ago is the one most likely due, so it leads.
  const points = startingPoints(workouts, STARTING_POINTS).toReversed();
  return (
    <>
      <section className="hero">
        <p className="label">{formatLongDay(localToday())}</p>
        <h1>{points.length === 0 ? "Log your first session" : "What are you training?"}</h1>
      </section>
      {points.length > 0 && (
        <ul className="starting-points">
          {points.map((past) => (
            <li key={past.id}>
              <button type="button" className="card starting-point" onClick={() => actions.startFrom(past)}>
                <strong>{past.entries.map((entry) => entry.exercise.name).join(" · ")}</strong>
                <span className="muted">Last done {formatDay(past.date)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={points.length === 0 ? "primary start" : "start"} onClick={actions.start}>
        {points.length === 0 ? "Start workout" : "Start an empty workout"}
      </button>
      <Standings exercises={exercises} workouts={workouts} />
    </>
  );
};
