import type { Answer, Commute, Contribution, Option, Question, Ranking } from "../contract";
import { exclusion } from "./questions";

/** A commute up to this long costs nothing; each minute beyond it costs `POINTS_PER_EXTRA_MINUTE`. */
const COMMUTE_TARGET_MINUTES = 40;
const POINTS_PER_EXTRA_MINUTE = 0.1;
/** Points for each 1% cheaper per sq ft than the median, up to `MAX_VALUE_POINTS` either way. */
const POINTS_PER_PERCENT_CHEAPER = 0.2;
const MAX_VALUE_POINTS = 4;

export type RankingInput = {
  /** Answers to the questions as currently worded, by question key. */
  readonly answers: ReadonlyMap<string, Answer>;
  readonly commutes: readonly Commute[];
  readonly pricePerSqft: number | null;
  /** Of the properties still to triage. */
  readonly medianPricePerSqft: number | null;
};

/** Expected points over the options, and the likeliest one. */
const weigh = (options: readonly Option[], probabilities: readonly number[]) => {
  const p = (index: number) => probabilities[index] ?? 0;
  const likeliest = options.reduce((best, _, index) => (p(index) > p(best) ? index : best), 0);
  return {
    points: options.reduce((sum, option, index) => sum + option.points * p(index), 0),
    detail: options[likeliest]?.label ?? "",
  };
};

const fromAnswer = (question: Question, answer: Answer | undefined): Contribution | null => {
  if (question.kind === "feature" && answer?.kind === "noul") {
    return { label: question.label, detail: answer.yes >= 0.5 ? "Yes" : "No", points: question.points * answer.yes };
  }
  if (question.kind === "choice" && answer?.kind === "choice") {
    return {
      label: question.label,
      ...weigh(
        question.options,
        question.options.map((option) => answer.probabilities[option.key] ?? 0),
      ),
    };
  }
  if (question.kind === "score" && answer?.kind === "score") {
    return { label: question.label, ...weigh(question.levels, answer.probabilities) };
  }
  return null;
};

const fromCommute = (commute: Commute): Contribution | null =>
  commute.minutes === null
    ? null
    : {
        label: `Commute to ${commute.name}`,
        detail: `${commute.minutes} min`,
        points: Math.min(0, (COMMUTE_TARGET_MINUTES - commute.minutes) * POINTS_PER_EXTRA_MINUTE),
      };

const fromValue = (pricePerSqft: number | null, median: number | null): Contribution | null => {
  if (pricePerSqft === null || median === null || median <= 0) {
    return null;
  }
  const percentCheaper = (1 - pricePerSqft / median) * 100;
  return {
    label: "Price per sq ft",
    detail: `${Math.abs(Math.round(percentCheaper))}% ${percentCheaper >= 0 ? "below" : "above"} the inbox median`,
    points: Math.max(-MAX_VALUE_POINTS, Math.min(MAX_VALUE_POINTS, percentCheaper * POINTS_PER_PERCENT_CHEAPER)),
  };
};

/** Why a property ranks where it does: what Jev read from its listing, its commutes, and its price per sq ft. */
export const scoreProperty = (questions: readonly Question[], input: RankingInput): Ranking => {
  const reason = exclusion(questions, input.answers);
  if (reason !== null) {
    return { kind: "excluded", reason };
  }
  const contributions = [
    ...questions.map((question) => fromAnswer(question, input.answers.get(question.key))),
    ...input.commutes.map(fromCommute),
    fromValue(input.pricePerSqft, input.medianPricePerSqft),
  ]
    .filter((contribution): contribution is Contribution => contribution !== null)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return {
    kind: "scored",
    total: contributions.reduce((sum, contribution) => sum + contribution.points, 0),
    contributions,
  };
};
