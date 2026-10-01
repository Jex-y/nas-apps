import { describe, expect, test } from "bun:test";
import type { Transaction } from "../../../../contract";
import { type DraftItem, draftOf, itemsOf, nextLine, remainderOf, tagOf } from "./split";

const purchase: Transaction = {
  id: "t",
  accountId: "a",
  bookedOn: "2026-09-18",
  amount: -2500,
  description: "TESCO STORES",
  counterparty: null,
  items: [{ id: "i", description: "", amount: -2500, tags: ["groceries"] }],
};

const line = (amount: string, fields: Partial<DraftItem> = {}): DraftItem => ({
  key: amount,
  description: "",
  amount,
  tags: [],
  ...fields,
});

describe("split drafts", () => {
  test("show a purchase's lines as positive amounts, and save them signed again", () => {
    const draft = draftOf(purchase);

    expect(draft).toEqual([{ key: "i", description: "", amount: "25.00", tags: ["groceries"] }]);
    expect(itemsOf(purchase, draft)).toEqual([{ description: "", amount: -2500, tags: ["groceries"] }]);
    expect(itemsOf({ ...purchase, amount: 2500 }, [line("25")])).toEqual([{ description: "", amount: 2500, tags: [] }]);
  });

  test("say what is left to account for, and offer it as the next line", () => {
    const draft = [line("19.00"), line("4")];

    expect(remainderOf(purchase, draft)).toBe(200);
    expect(nextLine(purchase, draft, "new")).toEqual({ key: "new", description: "", amount: "2.00", tags: [] });
    expect(remainderOf(purchase, [line("30"), line("-5", { description: "Voucher" })])).toBe(0);
    expect(nextLine(purchase, [line("25")], "new").amount).toBe("");
  });

  test("wait for every amount to be a number", () => {
    expect(itemsOf(purchase, [line("19"), line("six")])).toBeNull();
    expect(remainderOf(purchase, [line("")])).toBeNull();
  });
});

describe("tagOf", () => {
  test("normalises a typed tag as the server will", () => {
    expect(tagOf("  Eating Out ")).toBe("eating out");
    expect(tagOf(" ")).toBeNull();
  });
});
