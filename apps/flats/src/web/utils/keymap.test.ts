import { describe, expect, test } from "bun:test";
import { advance, type Binding, strokeOf } from "./keymap";

const press = (key: string, held: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) =>
  strokeOf({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...held });

describe("strokeOf", () => {
  test("names a key as the browser does, shift included", () => {
    expect(press("j")).toBe("j");
    expect(press("G", { shiftKey: true })).toBe("G");
    expect(press("ArrowLeft")).toBe("ArrowLeft");
  });

  test("names the space bar, which has no printable key", () => {
    expect(press(" ")).toBe("Space");
    expect(press(" ", { shiftKey: true })).toBe("shift+Space");
  });

  test("marks Control", () => {
    expect(press("d", { ctrlKey: true })).toBe("ctrl+d");
  });

  test("leaves the browser its own chords, and ignores a modifier alone", () => {
    expect(press("r", { metaKey: true })).toBeNull();
    expect(press("ArrowLeft", { altKey: true })).toBeNull();
    expect(press("Shift", { shiftKey: true })).toBeNull();
  });
});

describe("advance", () => {
  const binding = (...keys: string[]): Binding => ({ keys, does: keys.join(), run: () => undefined });
  const next = binding("j", "ArrowDown");
  const top = binding("g g");
  const portal = binding("g x");
  const bindings = [next, top, portal];

  test("runs a binding on any of its keys", () => {
    expect(advance(bindings, [], "j")).toEqual({ kind: "run", binding: next });
    expect(advance(bindings, [], "ArrowDown")).toEqual({ kind: "run", binding: next });
  });

  test("waits on the first key of a sequence, then runs the one it completes", () => {
    expect(advance(bindings, [], "g")).toEqual({ kind: "pending", strokes: ["g"] });
    expect(advance(bindings, ["g"], "g")).toEqual({ kind: "run", binding: top });
    expect(advance(bindings, ["g"], "x")).toEqual({ kind: "run", binding: portal });
  });

  test("misses a key bound to nothing", () => {
    expect(advance(bindings, [], "z")).toEqual({ kind: "miss" });
    expect(advance(bindings, [], "x")).toEqual({ kind: "miss" });
  });

  test("reads a key that ends no sequence as the start of one", () => {
    expect(advance(bindings, ["g"], "j")).toEqual({ kind: "run", binding: next });
    expect(advance(bindings, ["g"], "z")).toEqual({ kind: "miss" });
  });
});
