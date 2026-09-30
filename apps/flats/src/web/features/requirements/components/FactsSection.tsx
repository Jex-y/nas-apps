import { FACT_KEYS, type FactKey, type Requirements } from "../../../../contract";
import { FACTS } from "../../../../scoring";
import { DEFAULT_RULES, replaceRule } from "../utils/edit";
import { factValues } from "../utils/facts";
import type { Row } from "../utils/rank";

const BINS = 14;

const coverage = (fact: FactKey, rows: readonly Row[], median: number | null) =>
  rows.filter((row) => factValues(fact, [row], median).length > 0).length;

const Histogram = ({ values }: { values: readonly number[] }) => {
  if (values.length === 0) {
    return <span className="histogram empty" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / BINS || 1;
  const counts = Array.from(
    { length: BINS },
    (_, bin) =>
      values.filter((value) => {
        const at = Math.min(BINS - 1, Math.floor((value - min) / width));
        return at === bin;
      }).length,
  );
  const tallest = Math.max(...counts);
  return (
    <span className="histogram" aria-hidden="true">
      {counts.map((count, bin) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: bins are positional
        <span key={bin} style={{ blockSize: `${count === 0 ? 0 : 12 + (count / tallest) * 88}%` }} />
      ))}
    </span>
  );
};

const range = (fact: FactKey, values: readonly number[]) => {
  if (values.length === 0) {
    return "None stated";
  }
  const { describe } = FACTS[fact];
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? describe(low) : `${describe(low)} to ${describe(high)}`;
};

export const FactsSection = ({
  requirements,
  onChange,
  rows,
  medianPricePerSqft,
  onWeigh,
}: {
  requirements: Requirements;
  onChange: (next: Requirements) => void;
  rows: readonly Row[];
  medianPricePerSqft: number | null;
  onWeigh: () => void;
}) => {
  const inPlay = rows.filter((row) => row.property.status !== "rejected");
  const scored = new Set(requirements.facts.map((rule) => rule.fact));
  return (
    <div className="editor-section">
      <p className="editor-intro">
        What each listing states outright, timed by TfL or compared with your inbox. Jev plays no part in these; any of
        them can add to a score.
      </p>
      <ul className="fact-list">
        {FACT_KEYS.map((fact) => {
          const values = factValues(fact, inPlay, medianPricePerSqft);
          const known = coverage(fact, inPlay, medianPricePerSqft);
          return (
            <li key={fact} className="fact-row">
              <span className="fact-name">
                <strong>{FACTS[fact].label}</strong>
                <span className="muted">
                  {known === inPlay.length ? `All ${inPlay.length} flats` : `${known} of ${inPlay.length} flats`}
                </span>
              </span>
              <Histogram values={values} />
              <span className="fact-range">{range(fact, values)}</span>
              {scored.has(fact) ? (
                <button type="button" className="chip-button scored" onClick={onWeigh}>
                  Scored
                </button>
              ) : (
                <button
                  type="button"
                  className="chip-button"
                  disabled={values.length === 0}
                  onClick={() => onChange(replaceRule(requirements, fact, DEFAULT_RULES[fact]))}
                >
                  Score it
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
