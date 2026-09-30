import type { Limits, Question, Requirements } from "../../../../contract";
import { breach } from "../../../../scoring";
import { newQuestion, removeQuestion, replaceQuestion } from "../utils/edit";
import type { Row } from "../utils/rank";
import { NumberField, TextArea, TextField } from "./fields";

type LimitKey = keyof Limits;

const LIMITS: readonly { key: LimitKey; label: string; unit: string; fallback: number; step: number }[] = [
  { key: "minSizeSqft", label: "Smaller than", unit: "sq ft", fallback: 650, step: 25 },
  { key: "maxAnnualServiceCharge", label: "Service charge over", unit: "£ a year", fallback: 6000, step: 250 },
  { key: "minLeaseYears", label: "Lease shorter than", unit: "years", fallback: 90, step: 5 },
];

const NONE: Limits = { minSizeSqft: null, maxAnnualServiceCharge: null, minLeaseYears: null };

const flats = (count: number) => (count === 1 ? "1 flat" : `${count} flats`);

const Impact = ({ count }: { count: number }) => (
  <span className={count === 0 ? "impact none" : "impact"}>
    {count === 0 ? "Rules out none" : `Rules out ${flats(count)}`}
  </span>
);

export const RuleOutSection = ({
  requirements,
  onChange,
  rows,
}: {
  requirements: Requirements;
  onChange: (next: Requirements) => void;
  rows: readonly Row[];
}) => {
  const exclusions = requirements.questions.filter(
    (question): question is Extract<Question, { kind: "exclusion" }> => question.kind === "exclusion",
  );
  const setLimit = (key: LimitKey, value: number | null) =>
    onChange({ ...requirements, limits: { ...requirements.limits, [key]: value } });

  return (
    <div className="editor-section">
      <section className="editor-card">
        <header className="editor-card-heading">
          <h3>Limits</h3>
          <p className="muted">From each listing's own details. A flat that doesn't say is never ruled out.</p>
        </header>
        <ul className="limit-list">
          {LIMITS.map(({ key, label, unit, fallback, step }) => {
            const value = requirements.limits[key];
            const on = value !== null;
            // Over every flat, rejected ones too: a limit rejects a flat as it arrives, so most it rules out already are.
            const count = on
              ? rows.filter((row) => breach(row.property, { ...NONE, [key]: value }) !== null).length
              : 0;
            return (
              <li key={key} className={on ? "limit" : "limit off"}>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) => setLimit(key, event.target.checked ? fallback : null)}
                  />
                  <span className="visually-hidden">Use the limit</span>
                </label>
                <span className="limit-label">{label}</span>
                {on ? (
                  <NumberField
                    label={label}
                    hideLabel
                    value={value}
                    step={step}
                    unit={unit}
                    onChange={(next) => setLimit(key, next)}
                  />
                ) : (
                  <span className="muted limit-off">Off</span>
                )}
                {on && <Impact count={count} />}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="editor-card">
        <header className="editor-card-heading">
          <h3>Exclusions</h3>
          <p className="muted">Jev reads the listing and rules a flat out when it is more than 80% sure.</p>
        </header>
        <ul className="question-list">
          {exclusions.map((question) => {
            const count = rows.filter(
              (row) => row.draft.kind === "excluded" && row.draft.reason === question.reason,
            ).length;
            const set = (next: Partial<typeof question>) =>
              onChange(replaceQuestion(requirements, question.key, { ...question, ...next }));
            return (
              <li key={question.key} className="question-card">
                <div className="question-card-heading">
                  <TextField
                    label="Name"
                    hideLabel
                    className="question-name"
                    value={question.label}
                    onChange={(label) => set({ label })}
                  />
                  <Impact count={count} />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${question.label}`}
                    onClick={() => onChange(removeQuestion(requirements, question.key))}
                  >
                    ×
                  </button>
                </div>
                <TextArea
                  label="Jev is asked"
                  value={question.instructions}
                  onChange={(instructions) => set({ instructions })}
                />
                <TextField label="Reason shown" value={question.reason} onChange={(reason) => set({ reason })} />
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="add-button"
          onClick={() =>
            onChange({
              ...requirements,
              questions: [
                ...requirements.questions,
                newQuestion("exclusion", new Set(requirements.questions.map((question) => question.key))),
              ],
            })
          }
        >
          + Add an exclusion
        </button>
        <p className="muted editor-note">Shared ownership is always ruled out.</p>
      </section>
    </div>
  );
};
