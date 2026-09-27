/**
 * Rightmove's listing pages serialise their model as one flat array in which every object property and array
 * element is an index into that array (so shared values are stored once). Negative indices are sentinels.
 */
export const unflatten = (flat: readonly unknown[]): unknown => {
  const hydrated = new Map<number, unknown>();

  const hydrate = (index: number): unknown => {
    if (index < 0) {
      return undefined;
    }
    if (hydrated.has(index)) {
      return hydrated.get(index);
    }
    const value = flat[index];
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      hydrated.set(index, out);
      for (const element of value) {
        out.push(hydrate(asIndex(element)));
      }
      return out;
    }
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      hydrated.set(index, out);
      for (const [key, element] of Object.entries(value)) {
        out[key] = hydrate(asIndex(element));
      }
      return out;
    }
    return value;
  };

  return hydrate(0);
};

const asIndex = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Expected an index into the flattened model, got ${JSON.stringify(value)}`);
  }
  return value;
};

/** Reads the first JSON value assigned by `marker` (e.g. `window.__PAGE_MODEL = `) from inline script. */
export const extractAssignedJson = (html: string, marker: string): unknown => {
  const start = html.indexOf(marker);
  if (start === -1) {
    return undefined;
  }
  const from = start + marker.length;
  let depth = 0;
  let inString = false;
  for (let i = from; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (char === "\\") {
        i++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) {
        return JSON.parse(html.slice(from, i + 1));
      }
    }
  }
  return undefined;
};
