import { describe, expect, test } from "bun:test";
import { HL_HISTORY, HL_HOLDINGS } from "../../test/support";
import { HlParseError, parseHlExport } from "./hl";

describe("parseHlExport", () => {
  test("reads an account's holdings, its name, date and uninvested cash", () => {
    expect(parseHlExport(HL_HOLDINGS)).toEqual({
      kind: "holdings",
      account: "HL Stocks & Shares ISA",
      asOf: "2026-09-18",
      cash: 25000,
      holdings: [
        {
          code: "B59G4Q7",
          name: "Vanguard FTSE Developed World ex-UK Equity Index Accumulation",
          units: 10.5,
          price: 92477,
          cost: 800000,
        },
        { code: "OCDO", name: "Ocado Group plc Ordinary 2p", units: 1000, price: 253.761, cost: 300000 },
      ],
    });
  });

  test("falls back to the stated cash, then none, and reads headings whose pound sign was mangled", () => {
    const mangled = HL_HOLDINGS.replaceAll("£", "�");
    expect(parseHlExport(mangled.replace(/Total value:.*\n/, ""))).toMatchObject({ cash: 25000 });
    expect(parseHlExport(mangled.replace(/Total (value|cash):.*\n/g, ""))).toMatchObject({ cash: 0 });
    expect(parseHlExport(`﻿${HL_HOLDINGS.replace(/Spreadsheet created at.*\n/, "")}`)).toMatchObject({
      asOf: null,
    });
  });

  test("reads a transaction history, skipping nothing that has a date and a value", () => {
    expect(parseHlExport(HL_HISTORY)).toEqual({
      kind: "transactions",
      transactions: [
        {
          tradedOn: "2026-09-18",
          reference: "B123456",
          description: "Ocado Group plc Ordinary 2p 1000 @ 298.805",
          amount: -300000,
        },
        { tradedOn: "2026-09-01", reference: "MANAGE FEE", description: "Management fee", amount: -375 },
        { tradedOn: "2026-09-01", reference: "MANAGE FEE", description: "Management fee", amount: -375 },
        { tradedOn: "2026-08-28", reference: "FPC", description: "Faster payment receipt", amount: 400000 },
      ],
    });
  });

  test("refuses other files, saying what it expected", () => {
    expect(() => parseHlExport("Date,Description,Amount\n2026-09-01,Tea,-2.50\n")).toThrow(HlParseError);
    expect(() => parseHlExport("Code,Stock,Units held\nABC,Example,10\n")).toThrow('The export has no "price" column');
  });
});
