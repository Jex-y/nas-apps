import type { ChoiceOption, Option, Question, Requirements } from "../../../../contract";
import { type NewQuestionKind, newQuestion, removeQuestion, replaceQuestion, slugify, uniqueKey } from "../utils/edit";
import type { Row } from "../utils/rank";
import { TextArea, TextField } from "./fields";

type Scored = Exclude<Question, { kind: "exclusion" }>;

const KIND_LABELS: Readonly<Record<Scored["kind"], string>> = {
  feature: "Yes or no",
  choice: "One of",
  score: "Scale",
};

/** Which answer Jev found likeliest on each scored flat, as shares of the flats. */
const Mix = ({ question, rows }: { question: Scored; rows: readonly Row[] }) => {
  const details = rows.flatMap((row) =>
    row.draft.kind === "scored"
      ? row.draft.contributions.filter((contribution) => contribution.key === question.key).map((c) => c.detail)
      : [],
  );
  if (details.length === 0) {
    return null;
  }
  const order =
    question.kind === "choice"
      ? question.options.map((option) => option.label)
      : question.kind === "score"
        ? question.levels.map((level) => level.label)
        : ["Yes", "No"];
  const counts = order
    .map((label) => ({ label, count: details.filter((detail) => detail === label).length }))
    .filter(({ count }) => count > 0);
  return (
    <div className="answer-mix" role="img" aria-label="Jev's likeliest answer across the flats">
      {counts.map(({ label, count }, index) => (
        <span
          key={label}
          className="answer-mix-part"
          style={{ flexGrow: count, "--shade": index } as React.CSSProperties}
          title={`${label}: ${count} of ${details.length}`}
        >
          <span className="answer-mix-label">{label}</span>
        </span>
      ))}
    </div>
  );
};

const OptionRows = <T extends Option>({
  items,
  noun,
  onChange,
  makeNew,
}: {
  items: readonly T[];
  noun: string;
  onChange: (items: T[]) => void;
  makeNew: (items: readonly T[]) => T;
}) => (
  <div className="option-rows">
    <ol>
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: levels are positional; options move only with their index
        <li key={index} className="option-row">
          <TextField
            label={`${noun} ${index + 1}`}
            hideLabel
            className="option-label"
            value={item.label}
            onChange={(label) => onChange(items.map((other, at) => (at === index ? { ...other, label } : other)))}
          />
          <TextField
            label={`What ${item.label || noun} means`}
            hideLabel
            className="option-description"
            value={item.description}
            onChange={(description) =>
              onChange(items.map((other, at) => (at === index ? { ...other, description } : other)))
            }
          />
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${item.label}`}
            disabled={items.length <= 2}
            onClick={() => onChange(items.filter((_, at) => at !== index))}
          >
            ×
          </button>
        </li>
      ))}
    </ol>
    <button type="button" className="add-button small" onClick={() => onChange([...items, makeNew(items)])}>
      + Add {noun.toLowerCase()}
    </button>
  </div>
);

const QuestionCard = ({
  question,
  isNew,
  savedOptions,
  onChange,
  onRemove,
  rows,
  taken,
}: {
  question: Scored;
  isNew: boolean;
  /** The option keys Jev has answered by, which must not change under it. */
  savedOptions: ReadonlySet<string>;
  onChange: (next: Question) => void;
  onRemove: () => void;
  rows: readonly Row[];
  taken: ReadonlySet<string>;
}) => {
  const readable = rows.filter((row) => row.property.status !== "rejected" && row.property.readable);
  const answered = readable.filter((row) => !row.unanswered.includes(question.key)).length;
  const relabel = (label: string) =>
    onChange({
      ...question,
      label,
      // Until it is saved nothing is stored against the key, so it can follow the name.
      ...(isNew && { key: uniqueKey(slugify(label), new Set([...taken].filter((key) => key !== question.key))) }),
    });

  return (
    <li className="question-card">
      <div className="question-card-heading">
        <TextField label="Name" hideLabel className="question-name" value={question.label} onChange={relabel} />
        <span className="kind-chip">{KIND_LABELS[question.kind]}</span>
        <button type="button" className="icon-button" aria-label={`Remove ${question.label}`} onClick={onRemove}>
          ×
        </button>
      </div>
      <TextArea
        label="Jev is asked"
        value={question.instructions}
        onChange={(instructions) => onChange({ ...question, instructions })}
        hint={
          <>
            Name what it reads in backticks: <code>description</code>, <code>key_features</code>,{" "}
            <code>property_type</code>.
          </>
        }
      />
      {question.kind === "feature" &&
        (question.criteria === undefined ? (
          <button
            type="button"
            className="link-button"
            onClick={() => onChange({ ...question, criteria: { yes: "…", no: "…" } })}
          >
            Describe what counts as yes and no
          </button>
        ) : (
          <div className="criteria">
            <TextField
              label="Yes means"
              value={question.criteria.yes}
              onChange={(yes) => onChange({ ...question, criteria: { yes, no: question.criteria?.no ?? "" } })}
            />
            <TextField
              label="No means"
              value={question.criteria.no}
              onChange={(no) => onChange({ ...question, criteria: { yes: question.criteria?.yes ?? "", no } })}
            />
            <button
              type="button"
              className="link-button"
              onClick={() => onChange({ ...question, criteria: undefined })}
            >
              Leave it to Jev
            </button>
          </div>
        ))}
      {question.kind === "choice" && (
        <OptionRows<ChoiceOption>
          items={question.options}
          noun="Option"
          onChange={(options) =>
            onChange({
              ...question,
              // A new option's key follows its label until it is saved.
              options: options.map((option, index) =>
                savedOptions.has(option.key)
                  ? option
                  : {
                      ...option,
                      key: uniqueKey(
                        slugify(option.label || "option"),
                        new Set(options.filter((_, at) => at !== index).map((other) => other.key)),
                      ),
                    },
              ),
            })
          }
          makeNew={(options) => ({
            key: uniqueKey("option", new Set(options.map((option) => option.key))),
            label: "",
            description: "",
            points: 0,
          })}
        />
      )}
      {question.kind === "score" && (
        <>
          <p className="field-hint">Levels run from worst to best.</p>
          <OptionRows<Option>
            items={question.levels}
            noun="Level"
            onChange={(levels) => onChange({ ...question, levels })}
            makeNew={() => ({ label: "", description: "", points: 0 })}
          />
        </>
      )}
      <footer className="question-status">
        {answered === readable.length ? (
          <span className="muted">Answered for all {readable.length} flats in play</span>
        ) : (
          <span className="status-warning">
            {answered === 0 ? "New wording: not answered yet" : `Answered for ${answered} of ${readable.length} flats`}
          </span>
        )}
        <Mix question={question} rows={rows} />
      </footer>
    </li>
  );
};

const ADDABLE: readonly (readonly [NewQuestionKind, string])[] = [
  ["feature", "Yes or no"],
  ["choice", "One of"],
  ["score", "Scale"],
];

export const JevSection = ({
  requirements,
  saved,
  onChange,
  rows,
}: {
  requirements: Requirements;
  saved: Requirements;
  onChange: (next: Requirements) => void;
  rows: readonly Row[];
}) => {
  const taken = new Set(requirements.questions.map((question) => question.key));
  const savedByKey = new Map(saved.questions.map((question) => [question.key, question]));
  const optionKeys = (key: string) => {
    const before = savedByKey.get(key);
    return new Set(before?.kind === "choice" ? before.options.map((option) => option.key) : []);
  };
  const scored = requirements.questions.filter((question): question is Scored => question.kind !== "exclusion");
  return (
    <div className="editor-section">
      <p className="editor-intro">
        Jev reads each listing's description, key features and type, and answers these. Change the wording and Jev has
        to read the flats again; what each answer is worth lives under Weights.
      </p>
      <ul className="question-list">
        {scored.map((question, index) => (
          <QuestionCard
            // By position: a new question's key follows its name, and remounting on each keystroke would lose focus.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={index}
            question={question}
            isNew={!savedByKey.has(question.key)}
            savedOptions={optionKeys(question.key)}
            taken={taken}
            rows={rows}
            onChange={(next) => onChange(replaceQuestion(requirements, question.key, next))}
            onRemove={() => onChange(removeQuestion(requirements, question.key))}
          />
        ))}
      </ul>
      <div className="add-row">
        <span className="muted">Add a question:</span>
        {ADDABLE.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className="add-button"
            onClick={() =>
              onChange({ ...requirements, questions: [...requirements.questions, newQuestion(kind, taken)] })
            }
          >
            + {label}
          </button>
        ))}
      </div>
    </div>
  );
};
