import { useEffect } from "react";
import { type LiftSet, Rpe } from "../../../../contract";
import { Icon } from "../../../components/Icon";
import { formatSet } from "../../../utils/format";

/** Half steps from a comfortable six to an all-out ten: the range a working set is rated in. */
const RPES = Rpe.array().parse([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);

/** Long enough to rack the bar and pick the phone up; after it the set simply stays unrated. */
const ASK_FOR_MS = 20_000;

type Props = {
  readonly set: LiftSet;
  readonly exercise: string;
  readonly onRate: (rpe: number | null) => void;
  readonly onClose: () => void;
};

/**
 * Asks how hard a set was, from the bottom of the screen where the thumb is. It lies over the page rather than in
 * it, so the rows under it stay where they are, and it leaves by itself if not answered.
 */
export const RatingBar = ({ set, exercise, onRate, onClose }: Props) => {
  useEffect(() => {
    const timer = setTimeout(onClose, ASK_FOR_MS);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <section className="rating" aria-label="Rate the set">
      <p className="rating-ask">
        <span>
          How hard was <strong className="numeric">{formatSet({ ...set, rpe: null })}</strong>?
          <span className="muted"> {exercise}</span>
        </span>
        <button type="button" className="quiet" aria-label="Leave it unrated" onClick={onClose}>
          <Icon name="close" />
        </button>
      </p>
      <div className="rpe">
        {RPES.map((rpe) => (
          <button
            key={rpe}
            type="button"
            className="numeric"
            aria-pressed={set.rpe === rpe}
            aria-label={`RPE ${rpe}`}
            onClick={() => onRate(set.rpe === rpe ? null : rpe)}
          >
            {rpe}
          </button>
        ))}
      </div>
    </section>
  );
};
