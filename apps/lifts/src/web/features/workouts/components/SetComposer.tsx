import { LiftSet, Rpe } from "../../../../contract";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Stepper } from "../../../components/Stepper";
import type { SetValues } from "../utils/prefill";

/** Half steps from a comfortable six to an all-out ten: the range a working set is rated in. */
const RPES = Rpe.array().parse([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);

/** The smallest change a pair of plates makes. */
const WEIGHT_STEP_KG = 2.5;

type Props = {
  readonly draft: SetValues;
  readonly onDraft: (draft: SetValues) => void;
  /** The place the set will take, or holds if it is being corrected. */
  readonly number: number;
  /** Present while an existing set is being corrected rather than a new one logged. */
  readonly editing: { readonly onDelete: () => void; readonly onCancel: () => void } | null;
  readonly onSubmit: () => void;
};

/** One set, built with the thumb: weight and reps on steppers, RPE on chips, and a single button to log it. */
export const SetComposer = ({ draft, onDraft, number, editing, onSubmit }: Props) => {
  const warmup = draft.kind === "warmup";

  return (
    <div className="composer">
      <div className="steppers">
        <Stepper
          label="Weight"
          unit="kilograms"
          value={draft.weightKg}
          step={WEIGHT_STEP_KG}
          schema={LiftSet.shape.weightKg}
          inputMode="decimal"
          onChange={(weightKg) => onDraft({ ...draft, weightKg })}
        />
        <Stepper
          label="Reps"
          unit="reps"
          value={draft.reps}
          step={1}
          schema={LiftSet.shape.reps}
          inputMode="numeric"
          onChange={(reps) => onDraft({ ...draft, reps })}
        />
      </div>
      <fieldset className="rpe">
        <legend className="label">RPE</legend>
        {RPES.map((rpe) => (
          <button
            key={rpe}
            type="button"
            className="numeric"
            aria-pressed={draft.rpe === rpe}
            onClick={() => onDraft({ ...draft, rpe: draft.rpe === rpe ? null : rpe })}
          >
            {rpe}
          </button>
        ))}
      </fieldset>
      <div className="composer-actions">
        <button
          type="button"
          className="toggle"
          aria-pressed={warmup}
          onClick={() => onDraft({ ...draft, kind: warmup ? "work" : "warmup" })}
        >
          Warm-up
        </button>
        {editing !== null && (
          <>
            <ConfirmButton confirm="Delete set?" onConfirm={editing.onDelete}>
              Delete
            </ConfirmButton>
            <button type="button" onClick={editing.onCancel}>
              Cancel
            </button>
          </>
        )}
        <button type="button" className="primary log" onClick={onSubmit}>
          {editing === null ? `Log set ${number}` : `Save set ${number}`}
        </button>
      </div>
    </div>
  );
};
