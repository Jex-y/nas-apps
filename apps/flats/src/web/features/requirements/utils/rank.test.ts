import { describe, expect, test } from "bun:test";
import { fingerprint } from "../../../../api/questions";
import type { Question, Requirements, StoredAnswer, WorkbenchProperty } from "../../../../contract";
import { drivers, explain, type RankInput, rankProperties, type Version } from "./rank";

const lift: Question = { key: "lift", kind: "feature", label: "Lift", points: 2, instructions: "Is there a lift?" };
const auction: Question = {
  key: "auction",
  kind: "exclusion",
  label: "Auction",
  reason: "Auction",
  instructions: "Is it sold at auction?",
};

const requirements: Requirements = {
  limits: { minSizeSqft: 500, maxAnnualServiceCharge: null, minLeaseYears: null },
  questions: [auction, lift],
  facts: [{ fact: "size_sqft", from: 500, perUnit: 0.01, min: null, max: null }],
};

const version = (document: Requirements): Version => ({
  requirements: document,
  fingerprints: new Map(document.questions.map((question) => [question.key, fingerprint(question)])),
});

const said = (question: Question, yes: number): StoredAnswer => ({
  fingerprint: fingerprint(question),
  answer: { kind: "noul", yes },
});

const property = (id: string, sizeSqft: number, answers: StoredAnswer[] = []): WorkbenchProperty => ({
  id,
  status: "new",
  address: id,
  postcode: null,
  price: 500_000,
  priceQualifier: "",
  availability: "available",
  propertyType: "Flat",
  bedrooms: 2,
  bathrooms: 1,
  sizeSqft,
  tenure: "leasehold",
  leaseYearsRemaining: null,
  annualServiceCharge: null,
  annualGroundRent: null,
  councilTaxBand: null,
  sharedOwnership: false,
  auction: false,
  thumbnailUrl: null,
  firstSeenAt: new Date(0).toISOString(),
  listings: [],
  commutes: [],
  crime: null,
  lastSale: null,
  ranking: { kind: "scored", total: 0, contributions: [] },
  rejectedReason: null,
  answers,
  readable: true,
});

const input = (overrides: Partial<RankInput> = {}): RankInput => ({
  draft: version(requirements),
  saved: version(requirements),
  properties: [
    property("roomy", 850, [said(auction, 0), said(lift, 0)]),
    property("lifted", 600, [said(auction, 0), said(lift, 1)]),
    property("tiny", 400, [said(auction, 0), said(lift, 1)]),
    property("gavel", 900, [said(auction, 0.95), said(lift, 1)]),
  ],
  medianPricePerSqft: null,
  asked: new Map(),
  ...overrides,
});

const ids = (rows: ReturnType<typeof rankProperties>) => rows.map((row) => row.property.id);

describe("ranking properties by a draft", () => {
  test("puts the best scored first, then the ones Jev rules out, then the ones a limit does", () => {
    const rows = rankProperties(input());

    expect(ids(rows)).toEqual(["roomy", "lifted", "gavel", "tiny"]);
    expect(rows.map((row) => [row.rank, row.draft.kind])).toEqual([
      [1, "scored"],
      [2, "scored"],
      [null, "excluded"],
      [null, "limited"],
    ]);
  });

  test("re-ranks as the draft's weights change, keeping the saved ranks to compare", () => {
    const heavierLift = { ...requirements, questions: [auction, { ...lift, points: 5 }] };
    const rows = rankProperties(input({ draft: version(heavierLift) }));

    expect(ids(rows).slice(0, 2)).toEqual(["lifted", "roomy"]);
    expect(rows.slice(0, 2).map((row) => [row.rank, row.savedRank])).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  test("names the reworded questions Jev has not answered, and uses answers asked for in this session", () => {
    const reworded = { ...lift, instructions: "Does the building have a lift?" };
    const draft = version({ ...requirements, questions: [auction, reworded] });

    expect(rankProperties(input({ draft }))[0]?.unanswered).toEqual(["lift"]);

    const asked = new Map([["roomy", [said(reworded, 1)]]]);
    const roomy = rankProperties(input({ draft, asked })).find((row) => row.property.id === "roomy");
    expect(roomy?.unanswered).toEqual([]);
    expect(roomy?.draft).toMatchObject({ kind: "scored", total: expect.closeTo(3.5 + 2, 9) });
  });

  test("brings back a flat a loosened limit no longer rules out", () => {
    const loosened = { ...requirements, limits: { ...requirements.limits, minSizeSqft: 300 } };
    const tiny = rankProperties(input({ draft: version(loosened) })).find((row) => row.property.id === "tiny");

    expect(tiny).toMatchObject({ draft: { kind: "scored" }, saved: { kind: "limited" }, savedRank: null });
  });
});

describe("explaining a score", () => {
  test("measures each attribute against the average flat in play, adding up to the score", () => {
    const rows = rankProperties(input());
    const [roomy] = rows;
    const explanation = roomy === undefined ? null : explain(roomy, rows);

    // roomy: size 3.5, lift 0; lifted: size 1, lift 2. The average flat scores 3.25.
    expect(explanation?.base).toBeCloseTo(3.25, 9);
    expect(explanation?.effects.map((effect) => [effect.key, effect.shap])).toEqual([
      ["size_sqft", expect.closeTo(1.25, 9)],
      ["lift", -1],
    ]);
    const sum = (explanation?.effects ?? []).reduce((total, effect) => total + effect.shap, explanation?.base ?? 0);
    expect(sum).toBeCloseTo(explanation?.total ?? Number.NaN, 9);
  });

  test("ranks the drivers by how far they move scores on average", () => {
    const rows = rankProperties(input());

    expect(drivers(rows).map((driver) => [driver.key, driver.importance])).toEqual([
      ["size_sqft", expect.closeTo(1.25, 9)],
      ["lift", 1],
    ]);
  });
});
