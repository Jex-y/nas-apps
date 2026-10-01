import type { Exercise } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { useWorkoutActions } from "../api/workouts";
import { WorkoutEditor } from "./WorkoutEditor";
import { WorkoutList } from "./WorkoutList";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly WorkoutDetail[];
};

/** How many past sessions sit under the start button, as a reminder of where things stand. */
const RECENT = 3;

/** The session under way, or the way into a new one. */
export const LogPage = ({ exercises, workouts }: Props) => {
  const actions = useWorkoutActions();
  const open = workouts.findLast((workout) => workout.finishedAt === null);

  if (open !== undefined) {
    return <WorkoutEditor key={open.id} workout={open} workouts={workouts} exercises={exercises} />;
  }
  const recent = workouts.slice(-RECENT).reverse();
  return (
    <>
      <button type="button" className="primary start" onClick={actions.start}>
        Start workout
      </button>
      {recent.length > 0 && (
        <>
          <h2>Recent</h2>
          <WorkoutList workouts={recent} />
        </>
      )}
    </>
  );
};
