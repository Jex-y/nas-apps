import type { Contribution } from "../../contract";
import { formatPoints } from "../utils/format";

/** Why a property scores as it does, one line per reason. */
export const Contributions = ({ total, contributions }: { total: number; contributions: readonly Contribution[] }) => (
  <section>
    <h2>Score {formatPoints(total)}</h2>
    <ul className="contributions">
      {contributions.map((contribution) => (
        <li key={contribution.label}>
          <span>
            {contribution.label} <span className="muted">{contribution.detail}</span>
          </span>
          <span className="points">{formatPoints(contribution.points)}</span>
        </li>
      ))}
    </ul>
  </section>
);
