import { describe, expect, test } from "bun:test";
import { agrees, searchQueries, sterlingCandidates } from "./resolve";

describe("searchQueries", () => {
  test("tries the code, then ever shorter starts of the name without its bracketed parts", () => {
    expect(searchQueries("B59G4Q7", "Vanguard FTSE Developed World ex-UK Equity Index Accumulation (GBP)")).toEqual([
      "B59G4Q7",
      "Vanguard FTSE Developed World ex-UK Equity",
      "Vanguard FTSE Developed World ex-UK",
      "Vanguard FTSE Developed World",
      "Vanguard FTSE Developed",
      "Vanguard FTSE",
    ]);
    expect(searchQueries("OCDO", "Ocado")).toEqual(["OCDO"]);
  });
});

describe("sterlingCandidates", () => {
  test("keeps London and sterling listings", () => {
    const symbols = ["OCDO:LSE", "0OC:FRA", "GB00B59G4Q73:GBP", "VWRL:LSE:GBP", "ETFT:PCQ:USD", "VUSA:LSE:GBX"];

    expect(sterlingCandidates(symbols.map((symbol) => ({ symbol, name: symbol }))).map(({ symbol }) => symbol)).toEqual(
      ["OCDO:LSE", "GB00B59G4Q73:GBP", "VWRL:LSE:GBP", "VUSA:LSE:GBX"],
    );
  });
});

describe("agrees", () => {
  test("allows a few days of drift, not another share class", () => {
    expect(agrees(92900, 92477)).toBe(true);
    expect(agrees(88000, 92477)).toBe(true);
    expect(agrees(61250, 92477)).toBe(false);
    expect(agrees(100, 0)).toBe(false);
  });
});
