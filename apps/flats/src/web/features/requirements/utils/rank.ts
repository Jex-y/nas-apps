import type { Answer, Contribution, Requirements, StoredAnswer, WorkbenchProperty } from "../../../../contract";
import { breach, matchingAnswers, scoreProperty } from "../../../../scoring";

const SHARED_OWNERSHIP = "Shared ownership";

/** How one version of the requirements judges a property. */
export type Verdict =
  | { readonly kind: "limited"; readonly reason: string }
  | { readonly kind: "excluded"; readonly reason: string }
  | { readonly kind: "scored"; readonly total: number; readonly contributions: readonly Contribution[] };

/** A version of the requirements, with its questions' fingerprints once the browser has hashed them. */
export type Version = { readonly requirements: Requirements; readonly fingerprints: ReadonlyMap<string, string> };

export type Row = {
  readonly property: WorkbenchProperty;
  readonly draft: Verdict;
  readonly saved: Verdict;
  /** 1 is best; `null` for a property that is not scored. */
  readonly rank: number | null;
  readonly savedRank: number | null;
  /** Draft questions Jev has not answered for this property in their current words. */
  readonly unanswered: readonly string[];
};

export type RankInput = {
  readonly draft: Version;
  readonly saved: Version;
  readonly properties: readonly WorkbenchProperty[];
  readonly medianPricePerSqft: number | null;
  /** Answers Jev gave in this session to wordings it had not seen, by property id. */
  readonly asked: ReadonlyMap<string, readonly StoredAnswer[]>;
};

const judge = (
  requirements: Requirements,
  property: WorkbenchProperty,
  answers: ReadonlyMap<string, Answer>,
  medianPricePerSqft: number | null,
): Verdict => {
  const limit = property.sharedOwnership ? SHARED_OWNERSHIP : breach(property, requirements.limits);
  return limit !== null
    ? { kind: "limited", reason: limit }
    : scoreProperty(requirements, { answers, facts: property, commutes: property.commutes, medianPricePerSqft });
};

const scoreOf = (verdict: Verdict) => (verdict.kind === "scored" ? verdict.total : Number.NEGATIVE_INFINITY);

/** 1-based ranks among the scored properties, best first; ties share the better rank. */
const ranksBy = (verdicts: ReadonlyMap<string, Verdict>): ReadonlyMap<string, number> => {
  const scored = [...verdicts].filter(([, verdict]) => verdict.kind === "scored");
  const ordered = scored.toSorted(([, a], [, b]) => scoreOf(b) - scoreOf(a));
  return new Map(
    ordered.map(([id, verdict]) => [id, 1 + ordered.findIndex(([, other]) => scoreOf(other) === scoreOf(verdict))]),
  );
};

/**
 * Every property still in play judged by the draft and by the saved requirements, best first under the draft; the
 * ones a limit or Jev rules out follow, then the ones already rejected.
 */
export const rankProperties = ({ draft, saved, properties, medianPricePerSqft, asked }: RankInput): Row[] => {
  const judged = properties.map((property) => {
    const stored = [...property.answers, ...(asked.get(property.id) ?? [])];
    const draftAnswers = matchingAnswers(draft.fingerprints, stored);
    return {
      property,
      draft: judge(draft.requirements, property, draftAnswers, medianPricePerSqft),
      saved: judge(saved.requirements, property, matchingAnswers(saved.fingerprints, stored), medianPricePerSqft),
      unanswered: draft.requirements.questions
        .filter((question) => !draftAnswers.has(question.key))
        .map((question) => question.key),
    };
  });
  const inPlay = judged.filter(({ property }) => property.status !== "rejected");
  const draftRanks = ranksBy(new Map(inPlay.map((row) => [row.property.id, row.draft])));
  const savedRanks = ranksBy(new Map(inPlay.map((row) => [row.property.id, row.saved])));
  const group = (row: (typeof judged)[number]) =>
    row.property.status === "rejected" ? 3 : row.draft.kind === "scored" ? 0 : row.draft.kind === "excluded" ? 1 : 2;
  return judged
    .map((row) => ({
      ...row,
      rank: draftRanks.get(row.property.id) ?? null,
      savedRank: savedRanks.get(row.property.id) ?? null,
    }))
    .toSorted((a, b) => group(a) - group(b) || scoreOf(b.draft) - scoreOf(a.draft));
};

/** One attribute's share of a property's score, measured against the average property in play. */
export type Effect = {
  readonly key: string;
  readonly source: Contribution["source"];
  readonly label: string;
  readonly detail: string;
  readonly points: number;
  /** `points` less the average property's points for the same attribute: its SHAP value, the score being additive. */
  readonly shap: number;
};

export type Explanation = {
  /** The average score in play, where the property's explanation starts. */
  readonly base: number;
  readonly total: number;
  /** Largest effect first. */
  readonly effects: readonly Effect[];
};

type Attribute = { readonly key: string; readonly source: Contribution["source"]; readonly label: string };

/** The average points each attribute earns across the scored properties; one a property lacks counts as 0. */
const averages = (rows: readonly Row[]) => {
  const scored = rows.flatMap((row) => (row.draft.kind === "scored" && row.rank !== null ? [row.draft] : []));
  const sums = new Map<string, number>();
  const attributes = new Map<string, Attribute>();
  for (const verdict of scored) {
    for (const { key, source, label, points } of verdict.contributions) {
      sums.set(key, (sums.get(key) ?? 0) + points);
      attributes.set(key, { key, source, label });
    }
  }
  const count = Math.max(1, scored.length);
  return {
    mean: new Map([...sums].map(([key, sum]) => [key, sum / count])),
    attributes: [...attributes.values()],
    base: scored.reduce((sum, verdict) => sum + verdict.total, 0) / count,
  };
};

/** Why one property scores what it does, relative to the average property in play. */
export const explain = (row: Row, rows: readonly Row[]): Explanation | null => {
  if (row.draft.kind !== "scored") {
    return null;
  }
  const { mean, attributes, base } = averages(rows);
  const own = new Map(row.draft.contributions.map((contribution) => [contribution.key, contribution]));
  const effects = attributes
    .map((attribute): Effect => {
      const contribution = own.get(attribute.key);
      const points = contribution?.points ?? 0;
      return {
        ...attribute,
        label: contribution?.label ?? attribute.label,
        detail: contribution?.detail ?? "Not known",
        points,
        shap: points - (mean.get(attribute.key) ?? 0),
      };
    })
    .toSorted((a, b) => Math.abs(b.shap) - Math.abs(a.shap));
  return { base, total: row.draft.total, effects };
};

/** One attribute across every scored property: its SHAP value on each, and how much it moves the ranking. */
export type Driver = Attribute & {
  readonly points: ReadonlyMap<string, { readonly shap: number; readonly points: number; readonly detail: string }>;
  /** Mean absolute SHAP value. */
  readonly importance: number;
};

/** What drives the ranking, most influential attribute first. */
export const drivers = (rows: readonly Row[]): Driver[] => {
  const { mean, attributes } = averages(rows);
  const scored = rows.filter((row) => row.draft.kind === "scored" && row.rank !== null);
  return attributes
    .map((attribute) => {
      const points = new Map(
        scored.map((row) => {
          const contribution =
            row.draft.kind === "scored"
              ? row.draft.contributions.find((candidate) => candidate.key === attribute.key)
              : undefined;
          const own = contribution?.points ?? 0;
          return [
            row.property.id,
            { shap: own - (mean.get(attribute.key) ?? 0), points: own, detail: contribution?.detail ?? "Not known" },
          ] as const;
        }),
      );
      const importance = [...points.values()].reduce((sum, { shap }) => sum + Math.abs(shap), 0) / (scored.length || 1);
      return { ...attribute, points, importance };
    })
    .toSorted((a, b) => b.importance - a.importance);
};
