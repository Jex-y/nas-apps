import type { Exercise } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { formatKg } from "../../../utils/format";
import { LIFT_NAMES, standings, summarise } from "../utils/lifts";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly WorkoutDetail[];
};

/** The estimated max in each competition lift and their total; nothing until one of them has been logged. */
export const Standings = ({ exercises, workouts }: Props) => {
  const { lifts, totalKg } = standings(summarise(exercises, workouts));

  if (lifts.every(({ maxKg }) => maxKg === null)) {
    return null;
  }
  return (
    <dl className="card standings" aria-label="Estimated one-rep maxes in kilograms">
      {lifts.map(({ lift, maxKg }) => (
        <div key={lift}>
          <dt className="label">{LIFT_NAMES[lift]}</dt>
          <dd className="numeric">{maxKg === null ? "–" : formatKg(maxKg)}</dd>
        </div>
      ))}
      <div className="total">
        <dt className="label">Total</dt>
        <dd className="numeric">{totalKg === null ? "–" : formatKg(totalKg)}</dd>
      </div>
    </dl>
  );
};
