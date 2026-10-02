/**
 * One thing the keyboard does. Each of `keys` sets it off: a key as the browser names it ("j", "G", "Enter"), with
 * "ctrl+" before it when Control is held, or several in a row separated by spaces ("g g").
 */
export type Binding = { readonly keys: readonly string[]; readonly does: string; readonly run: () => void };

type KeyPress = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

const MODIFIERS = ["Shift", "Control", "Alt", "Meta"];

/** The key pressed, as bindings name it; `null` for a modifier alone or a chord left to the browser. */
export const strokeOf = ({ key, ctrlKey, metaKey, altKey, shiftKey }: KeyPress): string | null => {
  if (metaKey || altKey || MODIFIERS.includes(key)) {
    return null;
  }
  // Shift already shows in a printable key ("G", "?"), but not in the space bar.
  const name = key === " " ? `${shiftKey ? "shift+" : ""}Space` : key;
  return ctrlKey ? `ctrl+${name}` : name;
};

export type Step =
  | { readonly kind: "run"; readonly binding: Binding }
  /** `strokes` begin a longer binding, so the next key decides. */
  | { readonly kind: "pending"; readonly strokes: readonly string[] }
  | { readonly kind: "miss" };

/** What `stroke` does after the `pending` ones; a key that ends no sequence is read again as the start of one. */
export const advance = (bindings: readonly Binding[], pending: readonly string[], stroke: string): Step => {
  const strokes = [...pending, stroke];
  const typed = strokes.join(" ");
  const binding = bindings.find(({ keys }) => keys.includes(typed));
  if (binding !== undefined) {
    return { kind: "run", binding };
  }
  if (bindings.some(({ keys }) => keys.some((key) => key.startsWith(`${typed} `)))) {
    return { kind: "pending", strokes };
  }
  return pending.length === 0 ? { kind: "miss" } : advance(bindings, [], stroke);
};

const LINE_PX = 80;

const scrollBy = (top: number) => window.scrollBy({ top, behavior: "instant" });

/** Moving around a page that is read rather than stepped through. */
export const SCROLL_BINDINGS: readonly Binding[] = [
  { keys: ["j"], does: "Scroll down", run: () => scrollBy(LINE_PX) },
  { keys: ["k"], does: "Scroll up", run: () => scrollBy(-LINE_PX) },
  { keys: ["ctrl+d"], does: "Half a page down", run: () => scrollBy(window.innerHeight / 2) },
  { keys: ["ctrl+u"], does: "Half a page up", run: () => scrollBy(-window.innerHeight / 2) },
  { keys: ["g g"], does: "Top", run: () => window.scrollTo({ top: 0, behavior: "instant" }) },
  {
    keys: ["G"],
    does: "Bottom",
    run: () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  },
];
