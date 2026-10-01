import { describe, expect, test } from "bun:test";
import { penceOf } from "./pence";

describe("penceOf", () => {
  test("reads pounds as banks and brokers write them", () => {
    expect(penceOf("12.34")).toBe(1234);
    expect(penceOf("-1,234.5")).toBe(-123450);
    expect(penceOf("+7")).toBe(700);
    expect(penceOf(".5")).toBe(50);
    expect(penceOf(" 4,000.00 ")).toBe(400000);
    expect(penceOf("0.29")).toBe(29);
    expect(penceOf("1.005")).toBe(101);
  });

  test("refuses what is not an amount", () => {
    expect(penceOf("")).toBeNull();
    expect(penceOf("n/a")).toBeNull();
    expect(penceOf("12.3.4")).toBeNull();
    expect(penceOf("-")).toBeNull();
  });
});
