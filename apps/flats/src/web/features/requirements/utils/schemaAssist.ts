import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { Diagnostic } from "@codemirror/lint";
import type { EditorState, Text } from "@codemirror/state";
import type { Tooltip } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { z } from "zod";

/** The subset of JSON Schema that `z.toJSONSchema` writes for the requirements. */
export type Schema = {
  readonly type?: string | readonly string[];
  readonly description?: string;
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
  readonly items?: Schema;
  readonly oneOf?: readonly Schema[];
  readonly anyOf?: readonly Schema[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly default?: unknown;
};

type Segment = string | number;

const VALUE_NODES = new Set(["Object", "Array", "String", "Number", "True", "False", "Null"]);

const keyOf = (property: SyntaxNode, doc: Text): string | null => {
  const name = property.getChild("PropertyName");
  if (name === null) {
    return null;
  }
  try {
    return JSON.parse(doc.sliceString(name.from, name.to));
  } catch {
    return null;
  }
};

const propertyValue = (property: SyntaxNode): SyntaxNode | null => {
  let child = property.lastChild;
  while (child !== null && !VALUE_NODES.has(child.name)) {
    child = child.prevSibling;
  }
  return child;
};

const valuesIn = (array: SyntaxNode): SyntaxNode[] => {
  const values: SyntaxNode[] = [];
  for (let child = array.firstChild; child !== null; child = child.nextSibling) {
    if (VALUE_NODES.has(child.name)) {
      values.push(child);
    }
  }
  return values;
};

const propertiesIn = (object: SyntaxNode): SyntaxNode[] => object.getChildren("Property");

/** A string property's value inside `object`, e.g. a question's `kind`, read even while the rest is half typed. */
const stringProperty = (object: SyntaxNode, key: string, doc: Text): string | null => {
  const property = propertiesIn(object).find((candidate) => keyOf(candidate, doc) === key);
  const value = property === undefined ? null : propertyValue(property);
  if (value?.name !== "String") {
    return null;
  }
  try {
    return JSON.parse(doc.sliceString(value.from, value.to));
  } catch {
    return null;
  }
};

/** Settles a union: drops `null`, and picks the branch tagged `kind` when the object has one. */
const settle = (schema: Schema, kind: string | null): Schema => {
  const options = schema.oneOf ?? schema.anyOf;
  if (options === undefined) {
    return schema;
  }
  const present = options.filter((option) => option.type !== "null");
  const [only] = present;
  if (present.length === 1 && only !== undefined) {
    return settle(only, kind);
  }
  const tagged = present.find((option) => option.properties?.kind?.const === kind);
  if (tagged !== undefined) {
    return tagged;
  }
  // No tag yet: offer every branch's fields, so `kind` itself can be completed first.
  return { type: "object", properties: Object.assign({}, ...present.map((option) => option.properties ?? {})) };
};

const step = (schema: Schema, segment: Segment): Schema | null =>
  typeof segment === "number" ? (schema.items ?? null) : (schema.properties?.[segment] ?? null);

/** The containers from the document's root down to `node`, each with the key or index leading on from it. */
const route = (node: SyntaxNode, doc: Text): { container: SyntaxNode; next: Segment | null }[] => {
  const chain: { container: SyntaxNode; next: Segment | null }[] = [];
  let child: SyntaxNode | null = null;
  for (let current: SyntaxNode | null = node; current !== null; child = current, current = current.parent) {
    if (current.name === "Object") {
      const via = child?.name === "Property" ? keyOf(child, doc) : null;
      chain.unshift({ container: current, next: via });
    } else if (current.name === "Array") {
      const via = child === null ? null : valuesIn(current).findIndex((value) => value.from === child?.from);
      chain.unshift({ container: current, next: via === null || via < 0 ? null : via });
    }
  }
  return chain;
};

/** The schema of the innermost container around `node`, or `null` where the schema says nothing. */
const containerSchema = (
  root: Schema,
  node: SyntaxNode,
  doc: Text,
): { container: SyntaxNode; schema: Schema } | null => {
  const chain = route(node, doc);
  let schema: Schema | null = root;
  for (const [index, { container, next }] of chain.entries()) {
    schema =
      schema === null
        ? null
        : settle(schema, container.name === "Object" ? stringProperty(container, "kind", doc) : null);
    if (index === chain.length - 1) {
      return schema === null ? null : { container, schema };
    }
    schema = schema === null || next === null ? null : step(schema, next);
  }
  return null;
};

const typeLabel = (schema: Schema): string => {
  if (schema.const !== undefined) {
    return JSON.stringify(schema.const);
  }
  if (schema.enum !== undefined) {
    return "one of";
  }
  const options = schema.anyOf ?? schema.oneOf;
  if (options !== undefined) {
    return [...new Set(options.map(typeLabel))].join(" or ");
  }
  return typeof schema.type === "string" ? schema.type : (schema.type?.join(" or ") ?? "value");
};

/** A starting value for a new field: its default, or an empty one of its type. */
const template = (schema: Schema): string => {
  if (schema.default !== undefined) {
    return JSON.stringify(schema.default);
  }
  if (schema.const !== undefined) {
    return JSON.stringify(schema.const);
  }
  const settled = settle(schema, null);
  const type = typeof settled.type === "string" ? settled.type : settled.type?.[0];
  switch (type) {
    case "string":
      return settled.enum?.[0] !== undefined ? JSON.stringify(settled.enum[0]) : '""';
    case "number":
    case "integer":
      return "0";
    case "boolean":
      return "false";
    case "array":
      return "[]";
    case "object":
      return "{}";
    default:
      return "null";
  }
};

const info = (schema: Schema) => {
  const values = schema.enum ?? (schema.const === undefined ? undefined : [schema.const]);
  return [
    schema.description,
    values === undefined ? null : `Values: ${values.map((value) => JSON.stringify(value)).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
};

/** Completes the keys an object may still take, and the values an enum or literal allows. */
export const schemaCompletion =
  (root: Schema) =>
  (context: CompletionContext): CompletionResult | null => {
    const doc = context.state.doc;
    const node = syntaxTree(context.state).resolveInner(context.pos, -1);
    const word = context.matchBefore(/"?[\w-]*"?$/);
    const inKey =
      node.name === "PropertyName" ||
      ((node.name === "{" || node.name === "," || node.name === "⚠") && node.parent?.name === "Object") ||
      node.name === "Object";
    const inValue = node.name === "String" && node.parent?.name === "Property";

    if (inKey) {
      const target = containerSchema(root, node, doc);
      if (target?.schema.properties === undefined) {
        return null;
      }
      const taken = new Set(propertiesIn(target.container).map((property) => keyOf(property, doc)));
      const options: Completion[] = Object.entries(target.schema.properties)
        .filter(
          ([key]) => !taken.has(key) || (node.name === "PropertyName" && keyOf(node.parent as SyntaxNode, doc) === key),
        )
        .map(([key, schema]): Completion => {
          const text = info(schema);
          return {
            label: key,
            type: "property",
            detail: typeLabel(schema),
            ...(text !== "" && { info: text }),
            apply: `"${key}": ${template(schema)}`,
            boost: target.schema.required?.includes(key) ? 1 : 0,
          };
        });
      const from = node.name === "PropertyName" ? node.from : (word?.from ?? context.pos);
      return { from, to: node.name === "PropertyName" ? node.to : context.pos, options, validFor: /^"?[\w-]*"?$/ };
    }
    if (inValue) {
      const property = node.parent as SyntaxNode;
      const key = keyOf(property, doc);
      const object = containerSchema(root, property, doc);
      const schema = key === null || object === null ? null : (object.schema.properties?.[key] ?? null);
      const settled = schema === null ? null : settle(schema, null);
      const values = settled?.enum ?? (settled?.const === undefined ? undefined : [settled.const]);
      if (values === undefined) {
        return null;
      }
      // Every allowed value, not just those matching what is typed: the point is to see the choice.
      return {
        from: node.from,
        to: node.to,
        filter: false,
        options: values.map((value) => ({ label: JSON.stringify(value), type: "enum", apply: JSON.stringify(value) })),
      };
    }
    return null;
  };

/** What a key is for, from the schema, on hover. */
export const schemaHover =
  (root: Schema) =>
  (state: EditorState, pos: number): Tooltip | null => {
    const node = syntaxTree(state).resolveInner(pos, 1);
    if (node.name !== "PropertyName" || node.parent === null) {
      return null;
    }
    const key = keyOf(node.parent, state.doc);
    const object = containerSchema(root, node.parent, state.doc);
    const schema = key === null || object === null ? null : (object.schema.properties?.[key] ?? null);
    if (schema === null) {
      return null;
    }
    return {
      pos: node.from,
      end: node.to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "schema-hover";
        const title = document.createElement("strong");
        title.textContent = `${key} `;
        const type = document.createElement("code");
        type.textContent = typeLabel(schema);
        title.append(type);
        dom.append(title);
        const text = info(schema);
        if (text) {
          const body = document.createElement("p");
          body.textContent = text;
          dom.append(body);
        }
        return { dom };
      },
    };
  };

/** The node a path leads to from the document's root: a key's value, or an array's item. */
const nodeAt = (state: EditorState, path: readonly PropertyKey[]): SyntaxNode | null => {
  let node: SyntaxNode | null = syntaxTree(state).topNode.firstChild;
  for (const segment of path) {
    if (node?.name === "Object") {
      const property = propertiesIn(node).find((candidate) => keyOf(candidate, state.doc) === segment);
      node = property === undefined ? null : propertyValue(property);
    } else if (node?.name === "Array" && typeof segment === "number") {
      node = valuesIn(node)[segment] ?? null;
    } else {
      return node;
    }
  }
  return node;
};

/**
 * The contract's own complaints, placed on the part of the document they are about; an unknown key is marked on the
 * key itself. Syntax errors are left to the JSON linter.
 */
export const schemaDiagnostics = (state: EditorState, contract: z.ZodType): Diagnostic[] => {
  let json: unknown;
  try {
    json = JSON.parse(state.doc.toString());
  } catch {
    return [];
  }
  const result = contract.safeParse(json);
  if (result.success) {
    return [];
  }
  return result.error.issues.flatMap((issue): Diagnostic[] => {
    const at = nodeAt(state, issue.path);
    if (issue.code === "unrecognized_keys" && at?.name === "Object") {
      return propertiesIn(at).flatMap((property) => {
        const name = property.getChild("PropertyName");
        const key = keyOf(property, state.doc);
        return name !== null && key !== null && issue.keys.includes(key)
          ? [{ from: name.from, to: name.to, severity: "error", message: `Unknown field "${key}"` }]
          : [];
      });
    }
    const target = at ?? syntaxTree(state).topNode;
    return [
      { from: target.from, to: Math.min(target.to, target.from + 400), severity: "error", message: issue.message },
    ];
  });
};
