import { type Answer, EXCLUSION_THRESHOLD, type Question, type Requirements, type Trial } from "../../../../contract";
import { Contributions } from "../../../components/Contributions";
import { formatPoints } from "../../../utils/format";

const percent = (p: number) => `${Math.round(p * 100)}%`;

const Bar = ({ label, p, likeliest }: { label: string; p: number; likeliest: boolean }) => (
  <li className={likeliest ? "bar likeliest" : "bar"}>
    <span className="bar-label">{label}</span>
    <span className="bar-track">
      <span className="bar-fill" style={{ width: percent(p) }} />
    </span>
    <span className="bar-value">{percent(p)}</span>
  </li>
);

/** One bar per possible answer, the likeliest emphasised. */
const Distribution = ({ bars }: { bars: readonly { label: string; p: number }[] }) => {
  const top = Math.max(...bars.map((bar) => bar.p));
  return (
    <ul className="bars">
      {bars.map((bar) => (
        <Bar key={bar.label} label={bar.label} p={bar.p} likeliest={bar.p === top} />
      ))}
    </ul>
  );
};

const bars = (question: Question, answer: Answer): readonly { label: string; p: number }[] | null => {
  switch (question.kind) {
    case "exclusion":
    case "feature":
      return answer.kind === "noul" ? [{ label: "Yes", p: answer.yes }] : null;
    case "choice":
      return answer.kind === "choice"
        ? question.options.map((option) => ({ label: option.label, p: answer.probabilities[option.key] ?? 0 }))
        : null;
    case "score":
      return answer.kind === "score"
        ? question.levels.map((level, index) => ({ label: level.label, p: answer.probabilities[index] ?? 0 }))
        : null;
  }
};

const QuestionResult = ({ question, answer }: { question: Question; answer: Answer | null }) => {
  const shown = answer === null ? null : bars(question, answer);
  return (
    <li className="question-result">
      <div className="question-heading">
        <strong>{question.label}</strong> <span className="muted">{question.kind}</span>
      </div>
      {shown === null ? <p className="muted">Not answered</p> : <Distribution bars={shown} />}
      {question.kind === "exclusion" && (
        <p className="muted">Rules the flat out above {percent(EXCLUSION_THRESHOLD)}.</p>
      )}
    </li>
  );
};

const Verdict = ({ trial }: { trial: Trial }) => {
  if (trial.rejectedBy !== null) {
    return <p className="verdict rejected">Rejected by a limit: {trial.rejectedBy}</p>;
  }
  if (trial.ranking.kind === "excluded") {
    return <p className="verdict rejected">Ruled out by Jev: {trial.ranking.reason}</p>;
  }
  return (
    <p className="verdict">
      Kept · score <span className="score">{formatPoints(trial.ranking.total)}</span>
    </p>
  );
};

/** How a draft of the requirements judges the sample flat: its verdict, each answer's distribution, and why it scores. */
export const TrialPanel = ({ trial, draft, stale }: { trial: Trial; draft: Requirements; stale: boolean }) => {
  const answerOf = new Map(trial.answers.map((answered) => [answered.key, answered.answer]));
  return (
    <div className={stale ? "trial stale" : "trial"}>
      <Verdict trial={trial} />
      <p className="muted">
        {trial.asked === 0 ? "Every answer was already known." : `Asked Jev ${trial.asked} of ${trial.answers.length}.`}
      </p>
      <ul className="question-results">
        {draft.questions.map((question) => (
          <QuestionResult key={question.key} question={question} answer={answerOf.get(question.key) ?? null} />
        ))}
      </ul>
      {trial.ranking.kind === "scored" && (
        <Contributions total={trial.ranking.total} contributions={trial.ranking.contributions} />
      )}
      <details>
        <summary>What Jev read</summary>
        <p className="muted">{trial.listing.propertyType}</p>
        <ul className="features">
          {trial.listing.keyFeatures.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <p className="prose">{trial.listing.description}</p>
      </details>
    </div>
  );
};
