import { json, jsonLanguage, jsonParseLinter } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { hoverTooltip, tooltips } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { Requirements } from "../../../../contract";
import { hangingIndent } from "../utils/hangingIndent";
import { type Schema, schemaCompletion, schemaDiagnostics, schemaHover } from "../utils/schemaAssist";

/** What the editor completes, checks and explains on hover, straight from the contract the server parses with. */
const SCHEMA = z.toJSONSchema(Requirements, { io: "input", unrepresentable: "any" }) as Schema;

/** Follows the app's colours, so it matches every theme and scheme without one of its own. */
const appTheme = EditorView.theme({
  "&": { backgroundColor: "var(--surface)", color: "var(--fg)", fontSize: "0.8125rem", height: "100%" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--surface-2)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklab, var(--accent) 22%, transparent) !important",
  },
  ".cm-matchingBracket": { backgroundColor: "transparent", outline: "1px solid var(--border-strong)" },
  ".cm-tooltip": {
    backgroundColor: "var(--surface-raised)",
    color: "var(--fg)",
    border: "1px solid var(--edge)",
    borderRadius: "var(--radius-small)",
    boxShadow: "var(--shadow-raised)",
    fontFamily: "var(--font-body)",
    fontSize: "0.8125rem",
    maxWidth: "26rem",
    padding: "0.25rem 0",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "color-mix(in oklab, var(--accent) 16%, transparent)",
    color: "var(--fg)",
  },
  ".cm-tooltip-autocomplete ul li": { padding: "0.2rem 0.6rem !important" },
  ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal", marginLeft: "0.75rem" },
  ".cm-completionInfo": { padding: "0.5rem 0.75rem" },
  ".cm-diagnostic": { padding: "0.4rem 0.75rem", borderLeftWidth: "3px" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--error)" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "wavy underline var(--error) 1px" },
  ".cm-lint-marker-error": { content: "none" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--surface-2)",
    border: "1px solid var(--border)",
    color: "var(--muted)",
  },
});

/** Syntax colours from the theme too: the default style's dark reds all but vanish on a dark ground. */
const appHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--fg)" },
  { tag: tags.string, color: "var(--accent)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--pink)" },
  { tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation], color: "var(--muted)" },
  { tag: tags.invalid, color: "var(--error)" },
]);

/**
 * The requirements as JSON, completed, checked and explained on hover from their schema; replacing `value` from
 * outside (e.g. reverting, or an edit in the visual editor) replaces the text being edited.
 */
export const JsonEditor = ({
  value,
  onChange,
  problems,
}: {
  value: string;
  onChange: (text: string) => void;
  problems: readonly string[];
}) => {
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
        jsonLanguage.data.of({ autocomplete: schemaCompletion(SCHEMA) }),
        linter(jsonParseLinter()),
        linter((view) => schemaDiagnostics(view.state, Requirements), { delay: 250 }),
        hoverTooltip((view, pos) => schemaHover(SCHEMA)(view.state, pos)),
        lintGutter(),
        EditorView.lineWrapping,
        hangingIndent,
        // On the page, not in the pane, whose scrolling would clip them.
        tooltips({ parent: document.body }),
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

  return (
    <div className="json-pane">
      <div ref={host} className="json-editor" />
      {problems.length > 0 && (
        <ul className="json-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <p className="field-hint">
        Press <kbd>Ctrl</kbd> <kbd>Space</kbd> for suggestions; hover a field to see what it does.
      </p>
    </div>
  );
};
