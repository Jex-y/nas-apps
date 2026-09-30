import {
  FACT_KEYS,
  type FactKey,
  type FactRule,
  type Option,
  type Question,
  type Requirements,
} from "../../../../contract";
import { FACTS } from "../../../../scoring";
import { DEFAULT_RULES, replaceQuestion, replaceRule } from "../utils/edit";
import { factValues } from "../utils/facts";
import type { Driver, Row } from "../utils/rank";
import { FactCurve } from "./FactCurve";
import { NumberField } from "./fields";

const POINT_STEP = 0.5;

type Scored = Exclude<Question, { kind: "exclusion" }>;

const Influence = ({ importance }: { importance: number }) => (
  <span className="influence" title="How far it moves a flat's score from the average, on average">
    <span className="influence-meter">
      <span style={{ inlineSize: `${Math.min(100, importance * 40)}%` }} />
    </span>
    ±{importance.toFixed(1)}
  </span>
);

/** Points for each answer, with a bar to compare them at a glance. */
const PointRows = <T extends Option>({ items, onChange }: { items: readonly T[]; onChange: (items: T[]) => void }) => {
  const reach = Math.max(1, ...items.map((item) => Math.abs(item.points)));
  return (
    <ol className="point-rows">
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: answers are positional here
        <li key={index} className="point-row">
          <span className="point-label">{item.label}</span>
          <span className="point-bar" aria-hidden="true">
            <span
              className={item.points < 0 ? "down" : "up"}
              style={{ inlineSize: `${(Math.abs(item.points) / reach) * 50}%` }}
            />
          </span>
          <NumberField
            label={`Points for ${item.label}`}
            hideLabel
            stepper
            step={POINT_STEP}
            value={item.points}
            onChange={(points) =>
              onChange(items.map((other, at) => (at === index ? { ...other, points: points ?? 0 } : other)))
            }
          />
        </li>
      ))}
    </ol>
  );
};

const JevWeight = ({ question, onChange }: { question: Scored; onChange: (next: Question) => void }) => {
  switch (question.kind) {
    case "feature":
      return (
        <PointRows
          items={[{ label: "Yes", description: "", points: question.points }]}
          onChange={([yes]) => onChange({ ...question, points: yes?.points ?? 0 })}
        />
      );
    case "choice":
      return <PointRows items={question.options} onChange={(options) => onChange({ ...question, options })} />;
    case "score":
      return <PointRows items={question.levels} onChange={(levels) => onChange({ ...question, levels })} />;
  }
};

const FactWeight = ({
  rule,
  values,
  onChange,
}: {
  rule: FactRule;
  values: readonly number[];
  onChange: (next: FactRule | null) => void;
}) => {
  const { unit } = FACTS[rule.fact];
  return (
    <div className="fact-weight">
      <FactCurve rule={rule} values={values} />
      <div className="rule-fields">
        <NumberField
          label="From"
          unit={unit}
          value={rule.from}
          onChange={(from) => onChange({ ...rule, from: from ?? 0 })}
        />
        <NumberField
          label="Points each"
          value={rule.perUnit}
          step={0.01}
          onChange={(perUnit) => onChange({ ...rule, perUnit: perUnit ?? 0 })}
        />
        <NumberField
          label="Floor"
          nullable
          placeholder="None"
          value={rule.min}
          step={POINT_STEP}
          onChange={(min) => onChange({ ...rule, min })}
        />
        <NumberField
          label="Cap"
          nullable
          placeholder="None"
          value={rule.max}
          step={POINT_STEP}
          onChange={(max) => onChange({ ...rule, max })}
        />
      </div>
      <button type="button" className="link-button" onClick={() => onChange(null)}>
        Stop scoring {FACTS[rule.fact].label.toLowerCase()}
      </button>
    </div>
  );
};

type Item =
  | { readonly kind: "jev"; readonly question: Scored; readonly importance: number }
  | { readonly kind: "fact"; readonly rule: FactRule; readonly importance: number };

const importanceOf = (drivers: readonly Driver[], key: string) =>
  drivers
    .filter((driver) => driver.key === key || driver.key.startsWith(`${key}:`))
    .reduce((sum, driver) => sum + driver.importance, 0);

export const WeightsSection = ({
  requirements,
  onChange,
  rows,
  drivers,
  medianPricePerSqft,
}: {
  requirements: Requirements;
  onChange: (next: Requirements) => void;
  rows: readonly Row[];
  drivers: readonly Driver[];
  medianPricePerSqft: number | null;
}) => {
  const inPlay = rows.filter((row) => row.property.status !== "rejected");
  const items: Item[] = [
    ...requirements.questions
      .filter((question): question is Scored => question.kind !== "exclusion")
      .map((question) => ({ kind: "jev" as const, question, importance: importanceOf(drivers, question.key) })),
    ...requirements.facts.map((rule) => ({
      kind: "fact" as const,
      rule,
      importance: importanceOf(drivers, rule.fact),
    })),
  ].toSorted((a, b) => b.importance - a.importance);
  const unscored = FACT_KEYS.filter((fact) => !requirements.facts.some((rule) => rule.fact === fact));

  return (
    <div className="editor-section">
      <p className="editor-intro">
        What each thing adds to a flat's score, most influential first. Jev's answers count in proportion to how sure it
        is; a fact scores along its line.
      </p>
      <ul className="weight-list">
        {items.map((item) => (
          <li key={item.kind === "jev" ? item.question.key : item.rule.fact} className="weight-card">
            <header className="weight-heading">
              <strong>{item.kind === "jev" ? item.question.label : FACTS[item.rule.fact].label}</strong>
              <span className={`source-chip ${item.kind}`}>{item.kind === "jev" ? "Jev" : "Fact"}</span>
              <Influence importance={item.importance} />
            </header>
            {item.kind === "jev" ? (
              <JevWeight
                question={item.question}
                onChange={(next) => onChange(replaceQuestion(requirements, item.question.key, next))}
              />
            ) : (
              <FactWeight
                rule={item.rule}
                values={factValues(item.rule.fact, inPlay, medianPricePerSqft)}
                onChange={(next) => onChange(replaceRule(requirements, item.rule.fact, next))}
              />
            )}
          </li>
        ))}
      </ul>
      {unscored.length > 0 && (
        <div className="add-row">
          <span className="muted">Score a fact:</span>
          {unscored.map((fact: FactKey) => (
            <button
              key={fact}
              type="button"
              className="add-button"
              onClick={() => onChange(replaceRule(requirements, fact, DEFAULT_RULES[fact]))}
            >
              + {FACTS[fact].label}
            </button>
          ))}
        </div>
      )}
      <p className="muted editor-note">Exclusions rule a flat out rather than scoring it, so they carry no weight.</p>
    </div>
  );
};
