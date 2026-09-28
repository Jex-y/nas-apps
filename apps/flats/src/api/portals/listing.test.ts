import { expect, test } from "bun:test";
import { mentionsSharedOwnership } from "./listing";

test("spots shared ownership in an advert's words, but not its denial", () => {
  expect(mentionsSharedOwnership("2 bed flat", "Shared Ownership: 25% share, rent £410 pcm")).toBe(true);
  expect(mentionsSharedOwnership("Available through shared-ownership")).toBe(true);
  expect(mentionsSharedOwnership("Non-shared ownership")).toBe(false);
  expect(mentionsSharedOwnership("Please note this is not a shared ownership property")).toBe(false);
  expect(mentionsSharedOwnership("No shared ownership or retirement restrictions")).toBe(false);
  expect(mentionsSharedOwnership("Shared garden, share of freehold")).toBe(false);
  expect(mentionsSharedOwnership()).toBe(false);
});
