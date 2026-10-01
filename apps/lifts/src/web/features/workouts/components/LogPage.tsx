import type { Exercise } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { formatLongDay, localToday } from "../../../utils/format";
import { Standings } from "../../exercises/components/Standings";
import { useWorkoutActions } from "../api/workouts";
import { WorkoutEditor } from "./WorkoutEditor";
import { WorkoutList } from "./WorkoutList";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly WorkoutDetail[];
};

/** The session under way, or the way into a new one. */
export const LogPage = ({ exercises, workouts }: Props) => {
  const actions = useWorkoutActions();
  const open = workouts.findLast((workout) => workout.finishedAt === null);

  if (open !== undefined) {
    return <WorkoutEditor key={open.id} workout={open} workouts={workouts} exercises={exercises} />;
  }
  const last = workouts.at(-1);
  return (
    <>
      <section className="hero">
        <p className="label">{formatLongDay(localToday())}</p>
        <h1>{last === undefined ? "Log your first session" : "Ready when you are"}</h1>
        <button type="button" className="primary start" onClick={actions.start}>
          Start workout
        </button>
      </section>
      <Standings exercises={exercises} workouts={workouts} />
      {last !== undefined && (
        <>
          <h2>Last session</h2>
          <WorkoutList workouts={[last]} />
        </>
      )}
    </>
  );
};
