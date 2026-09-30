import { json, jsonParseLinter } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";

/** Follows the app's colours, so it matches light and dark mode without a theme of its own. */
const appTheme = EditorView.theme({
  "&": { backgroundColor: "var(--surface)", color: "var(--fg)", fontSize: "0.85rem", height: "100%" },
  "&.cm-focused": { outline: "1px solid var(--accent)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)" },
  ".cm-gutters": { backgroundColor: "var(--surface-2)", color: "var(--muted)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--surface-2)" },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
});

/** Syntax colours from the theme too: the default style's dark reds all but vanish on a dark ground. */
const appHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--fg)" },
  { tag: tags.string, color: "var(--accent)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--pink)" },
  { tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation], color: "var(--muted)" },
  { tag: tags.invalid, color: "var(--error)" },
]);

/** A JSON editor; replacing `value` from outside (e.g. reverting) replaces the text being edited. */
export const JsonEditor = ({ value, onChange }: { value: string; onChange: (text: string) => void }) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initial = useRef(value);
  const latestOnChange = useRef(onChange);
  useEffect(() => {
    latestOnChange.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = host.current;
    if (parent === null) {
      return;
    }
    const editor = new EditorView({
      doc: initial.current,
      parent,
      extensions: [
        basicSetup,
        json(),
        linter(jsonParseLinter()),
        lintGutter(),
        EditorView.lineWrapping,
        appTheme,
        syntaxHighlighting(appHighlight),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            latestOnChange.current(update.state.doc.toString());
          }
        }),
      ],
    });
    view.current = editor;
    return () => editor.destroy();
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (editor !== null && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="json-editor" />;
};
