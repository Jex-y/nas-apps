import { Link } from "wouter";
import type { WorkoutDetail } from "../../../../log";
import { isWorkSet, tonnage } from "../../../../strength";
import { formatDay, formatKg, formatSet } from "../../../utils/format";

/** Workouts as given, each with its exercises and their work sets in brief. */
export const WorkoutList = ({ workouts }: { readonly workouts: readonly WorkoutDetail[] }) => (
  <ul className="card rows">
    {workouts.map((workout) => (
      <li key={workout.id}>
        <Link href={`/workouts/${workout.id}`} className="row-title">
          <time dateTime={workout.date}>{formatDay(workout.date)}</time>
          {workout.finishedAt === null && <span className="badge">Open</span>}
          <span className="trailing numeric">
            {formatKg(tonnage(workout.entries.flatMap((entry) => entry.sets)))} kg
          </span>
        </Link>
        {workout.entries.map((entry) => (
          <p key={entry.id} className="muted">
            {entry.exercise.name}{" "}
            <span className="numeric">{entry.sets.filter(isWorkSet).map(formatSet).join(" · ")}</span>
          </p>
        ))}
      </li>
    ))}
  </ul>
);
