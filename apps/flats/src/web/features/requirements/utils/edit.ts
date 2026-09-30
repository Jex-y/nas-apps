import type { FactKey, FactRule, Question, Requirements } from "../../../../contract";

/** `Outdoor space!` → `outdoor_space`; a key must start with a letter. */
export const slugify = (label: string): string => {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(slug) ? slug : `q_${slug || "new"}`;
};

/** `base`, or `base_2`, `base_3`… whichever is free. */
export const uniqueKey = (base: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
};

const ASK = "Do `description` or `key_features` say";

export type NewQuestionKind = Question["kind"];

/** A starting point for each kind of question, keyed so it cannot clash with the others. */
export const newQuestion = (kind: NewQuestionKind, taken: ReadonlySet<string>): Question => {
  switch (kind) {
    case "exclusion":
      return {
        key: uniqueKey("new_exclusion", taken),
        kind,
        label: "New exclusion",
        reason: "New exclusion",
        instructions: `${ASK} …?`,
      };
    case "feature":
      return { key: uniqueKey("new_feature", taken), kind, label: "New feature", points: 1, instructions: `${ASK} …?` };
    case "choice":
      return {
        key: uniqueKey("new_choice", taken),
        kind,
        label: "New choice",
        instructions: "Which … do `description` and `key_features` describe?",
        options: [
          { key: "yes", label: "Yes", description: "…", points: 1 },
          { key: "not_stated", label: "Not stated", description: "It is not mentioned", points: 0 },
        ],
      };
    case "score":
      return {
        key: uniqueKey("new_scale", taken),
        kind,
        label: "New scale",
        instructions: "How … do `description` and `key_features` suggest the flat is?",
        levels: [
          { label: "Poor", description: "…", points: -1 },
          { label: "Not mentioned", description: "It is not mentioned", points: 0 },
          { label: "Good", description: "…", points: 1 },
        ],
      };
  }
};

/** Where scoring a fact starts when it is first switched on: about a point across the usual range. */
export const DEFAULT_RULES: Readonly<Record<FactKey, FactRule>> = {
  commute_minutes: { fact: "commute_minutes", from: 40, perUnit: -0.1, min: null, max: 0 },
  percent_below_median_price: { fact: "percent_below_median_price", from: 0, perUnit: 0.2, min: -4, max: 4 },
  size_sqft: { fact: "size_sqft", from: 650, perUnit: 0.01, min: 0, max: 3 },
  bedrooms: { fact: "bedrooms", from: 1, perUnit: 1, min: 0, max: 2 },
  bathrooms: { fact: "bathrooms", from: 1, perUnit: 1, min: 0, max: 1 },
  lease_years: { fact: "lease_years", from: 125, perUnit: 0.02, min: -2, max: 0 },
  annual_service_charge: { fact: "annual_service_charge", from: 2000, perUnit: -0.0005, min: -2, max: 0 },
};

export const replaceQuestion = (requirements: Requirements, key: string, next: Question): Requirements => ({
  ...requirements,
  questions: requirements.questions.map((question) => (question.key === key ? next : question)),
});

export const removeQuestion = (requirements: Requirements, key: string): Requirements => ({
  ...requirements,
  questions: requirements.questions.filter((question) => question.key !== key),
});

export const replaceRule = (requirements: Requirements, fact: FactKey, next: FactRule | null): Requirements => ({
  ...requirements,
  facts:
    next === null
      ? requirements.facts.filter((rule) => rule.fact !== fact)
      : requirements.facts.some((rule) => rule.fact === fact)
        ? requirements.facts.map((rule) => (rule.fact === fact ? next : rule))
        : [...requirements.facts, next],
});
