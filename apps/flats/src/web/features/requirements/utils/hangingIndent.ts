import { type Range, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** How much further than its own indentation a wrapped line's continuation starts, in characters. */
const HANG = 2;

const decorate = (view: EditorView): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let position = from; position <= to; ) {
      const line = view.state.doc.lineAt(position);
      const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
      const width = indent + HANG;
      const decoration: Range<Decoration> = Decoration.line({
        attributes: { style: `padding-left: calc(${width}ch + 6px); text-indent: -${width}ch` },
      }).range(line.from);
      builder.add(decoration.from, decoration.to, decoration.value);
      position = line.to + 1;
    }
  }
  return builder.finish();
};

/** Wraps a long line under its own indentation, plus a little, rather than back at the left edge. */
export const hangingIndent = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = decorate(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
