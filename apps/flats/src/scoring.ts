import {
  type Answer,
  type Commute,
  type Contribution,
  type CrimeSummary,
  EXCLUSION_THRESHOLD,
  type FactKey,
  type FactRule,
  type Limits,
  type Option,
  type Question,
  type Ranking,
  type StoredAnswer,
} from "./contract";

/** The structured facts a property may state; `null` where its listing does not. */
export type PropertyFacts = {
  readonly price: number | null;
  readonly sizeSqft: number | null;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly leaseYearsRemaining: number | null;
  readonly annualServiceCharge: number | null;
  readonly crime: Pick<CrimeSummary, "perMonth"> | null;
};

export type RankingInput = {
  /** Answers to the questions as currently worded, by question key. */
  readonly answers: ReadonlyMap<string, Answer>;
  readonly facts: PropertyFacts;
  readonly commutes: readonly Commute[];
  /** Of the properties still to triage. */
  readonly medianPricePerSqft: number | null;
};

export const pricePerSqft = ({ price, sizeSqft }: Pick<PropertyFacts, "price" | "sizeSqft">): number | null =>
  price !== null && sizeSqft ? price / sizeSqft : null;

type FactDefinition = {
  readonly label: string;
  readonly unit: string;
  /** The fact's value for a property; commutes are read per destination instead. */
  readonly read: (facts: PropertyFacts, medianPricePerSqft: number | null) => number | null;
  readonly describe: (value: number) => string;
};

const count = (value: number) => value.toLocaleString("en-GB");

export const FACTS: Readonly<Record<FactKey, FactDefinition>> = {
  commute_minutes: {
    label: "Commute",
    unit: "min",
    read: () => null,
    describe: (minutes) => `${count(minutes)} min`,
  },
  percent_below_median_price: {
    label: "Price per sq ft",
    unit: "% below median",
    read: (facts, median) => {
      const perSqft = pricePerSqft(facts);
      return perSqft === null || median === null || median <= 0 ? null : (1 - perSqft / median) * 100;
    },
    describe: (percent) => `${Math.abs(Math.round(percent))}% ${percent >= 0 ? "below" : "above"} the inbox median`,
  },
  size_sqft: {
    label: "Size",
    unit: "sq ft",
    read: (facts) => facts.sizeSqft,
    describe: (sqft) => `${count(sqft)} sq ft`,
  },
  bedrooms: { label: "Bedrooms", unit: "beds", read: (facts) => facts.bedrooms, describe: count },
  bathrooms: { label: "Bathrooms", unit: "baths", read: (facts) => facts.bathrooms, describe: count },
  lease_years: {
    label: "Lease",
    unit: "years",
    read: (facts) => facts.leaseYearsRemaining,
    describe: (years) => `${count(years)} years left`,
  },
  annual_service_charge: {
    label: "Service charge",
    unit: "£ a year",
    read: (facts) => facts.annualServiceCharge,
    describe: (pounds) => `£${count(Math.round(pounds))} a year`,
  },
  crime_per_month: {
    label: "Crime nearby",
    unit: "a month",
    read: (facts) => facts.crime?.perMonth ?? null,
    describe: (crimes) => `${count(Math.round(crimes))} a month nearby`,
  },
};

/** `perUnit × (value − from)`, held within the rule's bounds. */
export const pointsFor = (rule: FactRule, value: number): number => {
  const raw = rule.perUnit * (value - rule.from);
  return Math.min(rule.max ?? Number.POSITIVE_INFINITY, Math.max(rule.min ?? Number.NEGATIVE_INFINITY, raw));
};

/** The limit the facts break, as a reason to reject, or `null`; a fact the listing doesn't state breaks nothing. */
export const breach = (
  facts: Pick<PropertyFacts, "sizeSqft" | "annualServiceCharge" | "leaseYearsRemaining">,
  limits: Limits,
): string | null => {
  if (limits.minSizeSqft !== null && facts.sizeSqft !== null && facts.sizeSqft < limits.minSizeSqft) {
    return `Under ${limits.minSizeSqft.toLocaleString("en-GB")} sq ft`;
  }
  if (
    limits.maxAnnualServiceCharge !== null &&
    facts.annualServiceCharge !== null &&
    facts.annualServiceCharge > limits.maxAnnualServiceCharge
  ) {
    return `Service charge over £${limits.maxAnnualServiceCharge.toLocaleString("en-GB")}`;
  }
  if (
    limits.minLeaseYears !== null &&
    facts.leaseYearsRemaining !== null &&
    facts.leaseYearsRemaining < limits.minLeaseYears
  ) {
    return `Lease under ${limits.minLeaseYears} years`;
  }
  return null;
};

/** A Jev System One question, as sent. */
export type Prompt =
  | {
      readonly type: "noul";
      readonly instructions: string;
      readonly criteria?: { readonly true: string; readonly false: string };
    }
  | { readonly type: "choice"; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> }
  | { readonly type: "score"; readonly instructions: string; readonly criteria: readonly string[] };

export const prompt = (question: Question): Prompt => {
  switch (question.kind) {
    case "exclusion":
      return { type: "noul", instructions: question.instructions };
    case "feature":
      return {
        type: "noul",
        instructions: question.instructions,
        ...(question.criteria && { criteria: { true: question.criteria.yes, false: question.criteria.no } }),
      };
    case "choice":
      return {
        type: "choice",
        instructions: question.instructions,
        criteria: Object.fromEntries(question.options.map((option) => [option.key, option.description])),
      };
    case "score":
      return {
        type: "score",
        instructions: question.instructions,
        criteria: question.levels.map((level) => level.description),
      };
  }
};

/** The exact text a question's wording is fingerprinted by, so the server and the browser agree. */
export const promptText = (question: Question): string => JSON.stringify(prompt(question));

export const FINGERPRINT_LENGTH = 16;

/** `fingerprint` in questions.ts, for the browser, where Web Crypto hashes only asynchronously. */
export const fingerprintInBrowser = async (question: Question): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(promptText(question)));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, FINGERPRINT_LENGTH);
};

/** The stored answers to questions worded as `fingerprints` says, by question key. */
export const matchingAnswers = (
  fingerprints: ReadonlyMap<string, string>,
  stored: readonly StoredAnswer[],
): ReadonlyMap<string, Answer> =>
  new Map(
    stored
      .filter((row) => fingerprints.get(row.questionKey) === row.fingerprint)
      .map((row) => [row.questionKey, row.answer]),
  );

/** Why the answers rule the property out, or `null`; an unanswered exclusion rules nothing out. */
export const exclusion = (questions: readonly Question[], answers: ReadonlyMap<string, Answer>): string | null => {
  for (const question of questions) {
    const answer = answers.get(question.key);
    if (question.kind === "exclusion" && answer?.kind === "noul" && answer.yes > EXCLUSION_THRESHOLD) {
      return question.reason;
    }
  }
  return null;
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
  const read = { key: question.key, source: "jev", label: question.label } as const;
  if (question.kind === "feature" && answer?.kind === "noul") {
    return { ...read, detail: answer.yes >= 0.5 ? "Yes" : "No", points: question.points * answer.yes };
  }
  if (question.kind === "choice" && answer?.kind === "choice") {
    return {
      ...read,
      ...weigh(
        question.options,
        question.options.map((option) => answer.probabilities[option.key] ?? 0),
      ),
    };
  }
  if (question.kind === "score" && answer?.kind === "score") {
    return { ...read, ...weigh(question.levels, answer.probabilities) };
  }
  return null;
};

const fromFact = (rule: FactRule, input: RankingInput): Contribution[] => {
  const { label, read, describe } = FACTS[rule.fact];
  if (rule.fact === "commute_minutes") {
    return input.commutes.flatMap(({ destinationId, name, minutes }) =>
      minutes === null
        ? []
        : [
            {
              key: `${rule.fact}:${destinationId}`,
              source: "fact",
              label: `${label} to ${name}`,
              detail: describe(minutes),
              points: pointsFor(rule, minutes),
            },
          ],
    );
  }
  const value = read(input.facts, input.medianPricePerSqft);
  return value === null
    ? []
    : [{ key: rule.fact, source: "fact", label, detail: describe(value), points: pointsFor(rule, value) }];
};

/** The parts of the requirements that score a property; the limits reject it before it is scored. */
export type ScoringRules = { readonly questions: readonly Question[]; readonly facts: readonly FactRule[] };

/** Why a property ranks where it does: what Jev read from its listing, and the facts the rules score. */
export const scoreProperty = ({ questions, facts }: ScoringRules, input: RankingInput): Ranking => {
  const reason = exclusion(questions, input.answers);
  if (reason !== null) {
    return { kind: "excluded", reason };
  }
  const contributions = [
    ...questions.flatMap((question) => fromAnswer(question, input.answers.get(question.key)) ?? []),
    ...facts.flatMap((rule) => fromFact(rule, input)),
  ].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return {
    kind: "scored",
    total: contributions.reduce((sum, contribution) => sum + contribution.points, 0),
    contributions,
  };
};
