import type { WorkoutDetail } from "../../../../log";
import { formatMonth } from "../../../utils/format";
import { WorkoutList } from "./WorkoutList";

export const HistoryPage = ({ workouts }: { readonly workouts: readonly WorkoutDetail[] }) => {
  const months = Map.groupBy(workouts.toReversed(), (workout) => workout.date.slice(0, 7));

  return (
    <>
      <h1>History</h1>
      {workouts.length === 0 && <p className="muted">Nothing logged yet. Sessions you finish are kept here.</p>}
      {[...months].map(([month, inMonth]) => (
        <section key={month} className="month">
          <h2>
            {formatMonth(`${month}-01`)}
            <span className="muted">{inMonth.length === 1 ? "1 session" : `${inMonth.length} sessions`}</span>
          </h2>
          <WorkoutList workouts={inMonth} />
        </section>
      ))}
    </>
  );
};
