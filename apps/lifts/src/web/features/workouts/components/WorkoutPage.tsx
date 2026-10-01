import { Link } from "wouter";
import type { Exercise } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { Icon } from "../../../components/Icon";
import { WorkoutEditor } from "./WorkoutEditor";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly WorkoutDetail[];
  readonly workoutId: string;
};

export const WorkoutPage = ({ exercises, workouts, workoutId }: Props) => {
  const workout = workouts.find((other) => other.id === workoutId);

  return (
    <>
      <Link href="/history" className="back-link">
        <Icon name="back" />
        History
      </Link>
      {workout === undefined ? (
        <p className="muted">That workout is not in the log.</p>
      ) : (
        <WorkoutEditor workout={workout} workouts={workouts} exercises={exercises} />
      )}
    </>
  );
};
