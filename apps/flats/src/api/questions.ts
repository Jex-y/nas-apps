import { createHash } from "node:crypto";
import type { ParsedListing } from "./portals/listing";

/** The listing text a question is answered from; instructions name its fields in backticks. */
export type ListingState = {
  readonly property_type: string;
  readonly key_features: readonly string[];
  readonly description: string;
};

export const listingState = (parsed: ParsedListing): ListingState => ({
  property_type: parsed.propertyType,
  key_features: parsed.keyFeatures,
  description: parsed.description,
});

export type Option = { readonly label: string; readonly description: string; readonly points: number };

type Base = { readonly key: string; readonly label: string; readonly instructions: string };

/** How a question is asked and what its answer is worth to the ranking. */
export type Question =
  /** Rules the property out when the answer is a confident yes. */
  | (Base & { readonly kind: "exclusion"; readonly reason: string })
  | (Base & {
      readonly kind: "feature";
      readonly points: number;
      readonly criteria?: { readonly yes: string; readonly no: string };
    })
  | (Base & { readonly kind: "choice"; readonly options: Readonly<Record<string, Option>> })
  /** Levels run from worst to best. */
  | (Base & { readonly kind: "score"; readonly levels: readonly Option[] });

/** A Jev System One question, as sent. */
export type Prompt =
  | {
      readonly type: "noul";
      readonly instructions: string;
      readonly criteria?: { readonly true: string; readonly false: string };
    }
  | { readonly type: "choice"; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> }
  | { readonly type: "score"; readonly instructions: string; readonly criteria: readonly string[] };

export type Answer =
  /** Probability that the answer is yes. */
  | { readonly kind: "noul"; readonly yes: number }
  /** Probability of each option, by option key. */
  | { readonly kind: "choice"; readonly probabilities: Readonly<Record<string, number>> }
  /** Probability of each level, in the question's order. */
  | { readonly kind: "score"; readonly probabilities: readonly number[] };

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
        criteria: Object.fromEntries(
          Object.entries(question.options).map(([key, option]) => [key, option.description]),
        ),
      };
    case "score":
      return {
        type: "score",
        instructions: question.instructions,
        criteria: question.levels.map((level) => level.description),
      };
  }
};

/**
 * Identifies a question's wording. A stored answer counts only while its fingerprint matches, so rewording a question
 * re-asks it everywhere, while changing its labels or points does not.
 */
export const fingerprint = (question: Question): string =>
  createHash("sha256")
    .update(JSON.stringify(prompt(question)))
    .digest("hex")
    .slice(0, 16);

export type StoredAnswer = { readonly questionKey: string; readonly fingerprint: string; readonly answer: Answer };

/** The stored answers to the questions as currently worded, by question key. */
export const currentAnswers = (
  questions: readonly Question[],
  stored: readonly StoredAnswer[],
): ReadonlyMap<string, Answer> => {
  const current = new Map(questions.map((question) => [question.key, fingerprint(question)]));
  return new Map(
    stored
      .filter((row) => current.get(row.questionKey) === row.fingerprint)
      .map((row) => [row.questionKey, row.answer]),
  );
};

export const unanswered = (questions: readonly Question[], stored: readonly StoredAnswer[]): Question[] => {
  const answered = currentAnswers(questions, stored);
  return questions.filter((question) => !answered.has(question.key));
};

/** How sure Jev must be before an exclusion rules a property out. */
const EXCLUSION_THRESHOLD = 0.8;

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

const IN_TEXT = "Do `description` or `key_features` say";

export const QUESTIONS: readonly Question[] = [
  {
    key: "retirement",
    kind: "exclusion",
    label: "Retirement",
    reason: "Retirement property",
    instructions: `${IN_TEXT} this is a retirement property, or restrict buyers by age (e.g. over 55s or over 60s)?`,
  },
  {
    key: "cash_buyers_only",
    kind: "exclusion",
    label: "Cash buyers only",
    reason: "Cash buyers only",
    instructions: `${IN_TEXT} the sale is to cash buyers only, or that the property is unmortgageable?`,
  },
  {
    key: "auction",
    kind: "exclusion",
    label: "Auction",
    reason: "Auction",
    instructions: `${IN_TEXT} the property is being sold by auction (traditional or modern method of auction)?`,
  },
  {
    key: "chain_free",
    kind: "feature",
    label: "Chain free",
    points: 1,
    instructions: `${IN_TEXT} the property is chain free or has no onward chain?`,
  },
  {
    key: "parking",
    kind: "feature",
    label: "Parking",
    points: 1,
    instructions: `${IN_TEXT} the flat comes with its own parking: an allocated space, a garage, or off-street parking?`,
    criteria: {
      yes: "An allocated space, garage or private off-street parking comes with the flat",
      no: "No parking, only permit or street parking, or parking is not mentioned",
    },
  },
  {
    key: "lift",
    kind: "feature",
    label: "Lift",
    points: 1,
    instructions: `${IN_TEXT} the building has a lift?`,
  },
  {
    key: "new_build",
    kind: "feature",
    label: "New build",
    points: 0,
    instructions: `${IN_TEXT} this is a new build flat that nobody has lived in yet?`,
  },
  {
    key: "outdoor_space",
    kind: "choice",
    label: "Outdoor space",
    instructions:
      "What outdoor space do `description` and `key_features` say the flat has for its own use? Pick the best one if there are several.",
    options: {
      private_garden: { label: "Private garden", description: "A garden only this flat can use", points: 3 },
      terrace: { label: "Terrace", description: "A roof terrace or terrace", points: 3 },
      balcony: { label: "Balcony", description: "A balcony", points: 2 },
      communal_garden: {
        label: "Communal garden",
        description: "Only a garden or grounds shared with other residents",
        points: 1,
      },
      none: { label: "None", description: "No outdoor space is mentioned", points: 0 },
    },
  },
  {
    key: "floor",
    kind: "choice",
    label: "Floor",
    instructions: "Which floor of the building is the flat on, according to `description` and `key_features`?",
    options: {
      basement: { label: "Basement", description: "Basement or lower ground floor", points: -3 },
      ground: { label: "Ground", description: "Ground floor", points: -1 },
      low: { label: "1st–2nd", description: "First or second floor", points: 0 },
      mid: { label: "3rd–6th", description: "Third to sixth floor", points: 1 },
      high: { label: "7th+", description: "Seventh floor or above, but not the top floor", points: 1 },
      top: { label: "Top", description: "The top floor or a penthouse", points: 2 },
      not_stated: { label: "Not stated", description: "The floor is not stated", points: 0 },
    },
  },
  {
    key: "heating",
    kind: "choice",
    label: "Heating",
    instructions: "How is the flat heated, according to `description` and `key_features`?",
    options: {
      gas_central: { label: "Gas central", description: "Gas central heating or a gas boiler", points: 1 },
      electric: {
        label: "Electric",
        description: "Electric heaters, storage heaters or electric boiler",
        points: -2,
      },
      communal: { label: "Communal", description: "Communal or district heating", points: -1 },
      heat_pump: { label: "Heat pump", description: "An air or ground source heat pump", points: 1 },
      underfloor: { label: "Underfloor", description: "Underfloor heating with no source stated", points: 0 },
      not_stated: { label: "Not stated", description: "Heating is not stated", points: 0 },
    },
  },
  {
    key: "natural_light",
    kind: "score",
    label: "Natural light",
    instructions: "How much natural light do `description` and `key_features` suggest the flat gets?",
    levels: [
      { label: "Not mentioned", description: "Described as dark, or light is not mentioned", points: 0 },
      { label: "Some", description: "Some light mentioned in passing", points: 1 },
      { label: "Bright", description: "Described as bright or light-filled", points: 2 },
      {
        label: "Very bright",
        description: "Strongly emphasised: dual aspect, floor-to-ceiling windows, south facing or flooded with light",
        points: 3,
      },
    ],
  },
  {
    key: "condition",
    kind: "score",
    label: "Condition",
    instructions: "What condition is the flat in, according to `description` and `key_features`?",
    levels: [
      { label: "Needs renovation", description: "Needs full renovation or modernisation", points: -3 },
      { label: "Dated", description: "Dated, needs some updating", points: -1 },
      { label: "Good", description: "Good, well kept", points: 1 },
      { label: "Refurbished", description: "Recently refurbished or new to a high standard", points: 2 },
    ],
  },
  {
    key: "quiet",
    kind: "score",
    label: "Quiet",
    instructions: "How quiet is the flat's setting, according to `description` and `key_features`?",
    levels: [
      {
        label: "Busy road",
        description: "On or overlooking a busy main road, railway or nightlife",
        points: -3,
      },
      { label: "Not mentioned", description: "Nothing said about noise or the street", points: 0 },
      { label: "Residential", description: "A residential street", points: 1 },
      {
        label: "Quiet",
        description: "Described as quiet, tucked away, a cul-de-sac or overlooking green space",
        points: 2,
      },
    ],
  },
];
