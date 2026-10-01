import type { WorkoutDetail } from "../../../../log";
import { WorkoutList } from "./WorkoutList";

export const HistoryPage = ({ workouts }: { readonly workouts: readonly WorkoutDetail[] }) => (
  <>
    <div className="page-heading">
      <h1>History</h1>
      <span className="muted">{workouts.length === 1 ? "1 workout" : `${workouts.length} workouts`}</span>
    </div>
    {workouts.length === 0 ? (
      <p className="muted">Nothing logged yet.</p>
    ) : (
      <WorkoutList workouts={workouts.toReversed()} />
    )}
  </>
);
