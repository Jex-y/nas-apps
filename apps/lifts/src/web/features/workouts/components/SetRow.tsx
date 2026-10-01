import { LiftSet } from "../../../../contract";
import { NumberField } from "../../../components/NumberField";
import type { WorkoutActions } from "../api/workouts";

/** Half steps from an easy five to an all-out ten. */
const RPES = Array.from({ length: 11 }, (_, index) => 5 + index / 2);

type Props = {
  readonly set: LiftSet;
  /** Its place among the entry's sets, from 1. */
  readonly number: number;
  readonly actions: WorkoutActions;
};

export const SetRow = ({ set, number, actions }: Props) => {
  const warmup = set.kind === "warmup";

  return (
    <li className={warmup ? "set-row warmup" : "set-row"}>
      <button
        type="button"
        className="set-kind"
        aria-pressed={warmup}
        aria-label={`Set ${number}: ${warmup ? "warm-up" : "work"} set`}
        title={warmup ? "Warm-up: tap to count it as a work set" : "Work set: tap to mark it a warm-up"}
        onClick={() => actions.updateSet(set, { kind: warmup ? "work" : "warmup" })}
      >
        {warmup ? "W" : number}
      </button>
      <NumberField
        value={set.weightKg}
        schema={LiftSet.shape.weightKg}
        label={`Set ${number} weight in kilograms`}
        inputMode="decimal"
        onCommit={(weightKg) => weightKg !== null && actions.updateSet(set, { weightKg })}
      />
      <span className="muted">kg ×</span>
      <NumberField
        value={set.reps}
        schema={LiftSet.shape.reps}
        label={`Set ${number} reps`}
        inputMode="numeric"
        onCommit={(reps) => reps !== null && actions.updateSet(set, { reps })}
      />
      <select
        className="numeric"
        value={set.rpe ?? ""}
        aria-label={`Set ${number} RPE`}
        onChange={(event) =>
          actions.updateSet(set, { rpe: event.target.value === "" ? null : Number(event.target.value) })
        }
      >
        <option value="">RPE</option>
        {(set.rpe === null || RPES.includes(set.rpe) ? RPES : [set.rpe, ...RPES]).map((rpe) => (
          <option key={rpe} value={rpe}>
            @{rpe}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="quiet"
        aria-label={`Delete set ${number}`}
        onClick={() => actions.removeSet(set)}
      >
        ×
      </button>
    </li>
  );
};
