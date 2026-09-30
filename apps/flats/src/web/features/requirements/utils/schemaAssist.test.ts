import { describe, expect, test } from "bun:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { z } from "zod";
import { Requirements } from "../../../../contract";
import { type Schema, schemaCompletion, schemaDiagnostics } from "./schemaAssist";

const SCHEMA = z.toJSONSchema(Requirements, { io: "input", unrepresentable: "any" }) as Schema;

/** A document with the cursor at `|`. */
const at = (text: string) => {
  const pos = text.indexOf("|");
  const state = EditorState.create({ doc: text.replace("|", ""), extensions: [json()] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return { state, pos };
};

const labels = (text: string) => {
  const { state, pos } = at(text);
  const result = schemaCompletion(SCHEMA)(new CompletionContext(state, pos, true));
  return result?.options.map((option) => option.label) ?? [];
};

describe("completing the requirements", () => {
  test("offers the top-level fields not yet written", () => {
    expect(labels('{ "limits": {}, | }').sort()).toEqual(["facts", "questions"]);
  });

  test("offers only the fields of the question's kind", () => {
    const fields = labels('{ "questions": [ { "kind": "feature", "key": "lift", | } ] }');

    expect(fields).toContain("points");
    expect(fields).toContain("criteria");
    expect(fields).not.toContain("options");
    expect(fields).not.toContain("key");
  });

  test("offers every kind's fields until the kind is written, so the kind comes first", () => {
    expect(labels('{ "questions": [ { | } ] }')).toEqual(expect.arrayContaining(["kind", "options", "levels"]));
  });

  test("offers the facts a rule can score", () => {
    expect(labels('{ "facts": [ { "fact": "|" } ] }')).toEqual(expect.arrayContaining(['"size_sqft"', '"bedrooms"']));
  });

  test("fills a new field with its default", () => {
    const { state, pos } = at('{ "limits": {}, "questions": [], | }');
    const facts = schemaCompletion(SCHEMA)(new CompletionContext(state, pos, true))?.options.find(
      (option) => option.label === "facts",
    );

    expect(String(facts?.apply)).toStartWith('"facts": [{"fact":"commute_minutes"');
  });
});

describe("checking the requirements", () => {
  const valid = { limits: { minSizeSqft: 650, maxAnnualServiceCharge: null, minLeaseYears: null }, questions: [] };
  const check = (document: unknown) => {
    const text = JSON.stringify(document, null, 2);
    const { state } = at(text);
    return schemaDiagnostics(state, Requirements).map((diagnostic) => ({
      text: text.slice(diagnostic.from, diagnostic.to),
      message: diagnostic.message,
    }));
  };

  test("finds nothing wrong with a valid document", () => {
    expect(check(valid)).toEqual([]);
  });

  test("marks an unknown field on its own key", () => {
    expect(check({ ...valid, limits: { ...valid.limits, minSizeSqf: 1 } })).toEqual([
      { text: '"minSizeSqf"', message: 'Unknown field "minSizeSqf"' },
    ]);
  });

  test("marks a bad value where it is", () => {
    const [problem] = check({ ...valid, facts: [{ fact: "size_sqft", from: 0, perUnit: 1, min: 5, max: 1 }] });

    expect(problem).toEqual({ text: "5", message: "min must not exceed max" });
  });
});
