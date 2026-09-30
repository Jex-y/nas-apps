import { type Answer, EXCLUSION_THRESHOLD, type Question } from "../../../../contract";

const percent = (p: number) => `${Math.round(p * 100)}%`;

type Bar = { readonly label: string; readonly p: number };

const barsOf = (question: Question, answer: Answer): readonly Bar[] | null => {
  switch (question.kind) {
    case "exclusion":
    case "feature":
      return answer.kind === "noul"
        ? [
            { label: "Yes", p: answer.yes },
            { label: "No", p: 1 - answer.yes },
          ]
        : null;
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

/** Jev's full distribution over a question's answers, the likeliest emphasised, as the Jev playground shows it. */
export const AnswerBars = ({ question, answer }: { question: Question; answer: Answer | null }) => {
  const bars = answer === null ? null : barsOf(question, answer);
  if (bars === null) {
    return <p className="muted answer-missing">Jev has not answered this wording yet.</p>;
  }
  const top = Math.max(...bars.map((bar) => bar.p));
  return (
    <>
      <ul className="answer-bars">
        {bars.map((bar) => (
          <li key={bar.label} className={bar.p === top ? "answer-bar likeliest" : "answer-bar"}>
            <span className="answer-label">{bar.label}</span>
            <span className="answer-track">
              <span className="answer-fill" style={{ inlineSize: percent(bar.p) }} />
            </span>
            <span className="answer-value">{percent(bar.p)}</span>
          </li>
        ))}
      </ul>
      {question.kind === "exclusion" && (
        <p className="muted answer-note">Rules the flat out above {percent(EXCLUSION_THRESHOLD)} yes.</p>
      )}
    </>
  );
};
