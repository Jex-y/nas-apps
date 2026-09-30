import { useEffect, useMemo, useState } from "react";
import type { Requirements, Workbench } from "../../../../contract";
import { matchingAnswers } from "../../../../scoring";
import { useRequirements, useSaveRequirements, useWorkbench } from "../api/requirements";
import { type Asking, useAskJev } from "../hooks/useAskJev";
import { useFingerprints } from "../hooks/useFingerprints";
import { formatDocument, parseDraft } from "../utils/draft";
import { drivers, type Row, rankProperties } from "../utils/rank";
import { Inspector } from "./Inspector";
import { JsonEditor } from "./JsonEditor";
import { Leaderboard } from "./Leaderboard";
import { VisualEditor } from "./VisualEditor";

/** The requirements, edited visually or as JSON, with every flat re-ranked live as they change. */
export const RequirementsPage = () => {
  const saved = useRequirements();
  const workbench = useWorkbench();
  const error = saved.error ?? workbench.error;
  if (error) {
    return <p className="error">{error.message}</p>;
  }
  if (saved.data === undefined || workbench.data === undefined) {
    return <p className="muted">Loading…</p>;
  }
  return <Editor key={formatDocument(saved.data)} saved={saved.data} workbench={workbench.data} />;
};

type Mode = "visual" | "json";
type Pane = "edit" | "ranking" | "why";

const PANES: readonly (readonly [Pane, string])[] = [
  ["edit", "Edit"],
  ["ranking", "Ranking"],
  ["why", "Why"],
];

const AskBanner = ({
  unread,
  questions,
  asking,
  onAsk,
  onCancel,
}: {
  unread: number;
  questions: number;
  asking: Asking;
  onAsk: () => void;
  onCancel: () => void;
}) => {
  if (asking.kind === "asking") {
    return (
      <div className="ask-banner asking" role="status">
        <span>
          Asking Jev… {asking.done} of {asking.total} flats
        </span>
        <span className="ask-progress">
          <span style={{ inlineSize: `${(asking.done / Math.max(1, asking.total)) * 100}%` }} />
        </span>
        <button type="button" onClick={onCancel}>
          Stop
        </button>
      </div>
    );
  }
  return (
    <div className={asking.kind === "failed" ? "ask-banner failed" : "ask-banner"}>
      <span>
        {asking.kind === "failed"
          ? asking.message
          : `Jev has not read ${questions === 1 ? "1 question" : `${questions} questions`} in these words for ${unread === 1 ? "1 flat" : `${unread} flats`}, so ${unread === 1 ? "it scores" : "they score"} without ${questions === 1 ? "it" : "them"}.`}
      </span>
      <button type="button" className="primary" onClick={onAsk}>
        {asking.kind === "failed" ? "Try again" : "Ask Jev"}
      </button>
    </div>
  );
};

const Editor = ({ saved, workbench }: { saved: Requirements; workbench: Workbench }) => {
  const [text, setText] = useState(() => formatDocument(saved));
  const draft = useMemo(() => parseDraft(text), [text]);
  const [lastValid, setLastValid] = useState(saved);
  useEffect(() => {
    if (draft.kind === "valid") {
      setLastValid(draft.requirements);
    }
  }, [draft]);
  const current = draft.kind === "valid" ? draft.requirements : lastValid;

  const draftPrints = useFingerprints(current.questions);
  const savedPrints = useFingerprints(saved.questions);
  const { asked, asking, ask, cancel } = useAskJev();

  const rows = useMemo(
    () =>
      draftPrints === null || savedPrints === null
        ? null
        : rankProperties({
            draft: { requirements: current, fingerprints: draftPrints },
            saved: { requirements: saved, fingerprints: savedPrints },
            properties: workbench.properties,
            medianPricePerSqft: workbench.medianPricePerSqft,
            asked,
          }),
    [current, saved, draftPrints, savedPrints, workbench, asked],
  );
  const driverList = useMemo(() => (rows === null ? [] : drivers(rows)), [rows]);

  const [chosen, setChosen] = useState<string | null>(null);
  const selected = rows?.find((row) => row.property.id === chosen) ?? rows?.[0] ?? null;
  const [mode, setMode] = useState<Mode>("visual");
  const [pane, setPane] = useState<Pane>("edit");
  const [showRejected, setShowRejected] = useState(false);

  const save = useSaveRequirements();
  const dirty = text !== formatDocument(saved);
  const moved = rows?.filter((row) => row.rank !== row.savedRank).length ?? 0;
  const inPlay = rows?.filter((row) => row.property.status !== "rejected") ?? [];
  const unread = inPlay.filter((row) => row.property.readable && row.unanswered.length > 0);
  const unreadQuestions = new Set(unread.flatMap((row) => row.unanswered)).size;

  const askAbout = (targets: readonly Row[]) => {
    if (draftPrints !== null) {
      void ask(
        current,
        draftPrints,
        targets.map((row) => row.property.id),
      );
    }
  };

  return (
    <section className="workbench" data-pane={pane}>
      <header className="workbench-header">
        <div>
          <h1 className="workbench-title">Requirements</h1>
          <p className="muted">
            What rules a flat out, what Jev reads from each listing, and what everything is worth.
          </p>
        </div>
        <div className="workbench-actions">
          <span className={`workbench-status ${draft.kind === "invalid" ? "invalid" : dirty ? "dirty" : ""}`}>
            {draft.kind === "invalid"
              ? `${draft.problems.length === 1 ? "1 problem" : `${draft.problems.length} problems`} in the JSON`
              : dirty
                ? moved === 0
                  ? "Unsaved changes"
                  : `Unsaved · ${moved === 1 ? "1 flat moves" : `${moved} flats move`}`
                : "Saved"}
          </span>
          <button type="button" disabled={!dirty} onClick={() => setText(formatDocument(saved))}>
            Revert
          </button>
          <button
            type="button"
            className="primary"
            disabled={!dirty || draft.kind === "invalid" || save.isPending}
            onClick={() => draft.kind === "valid" && save.mutate(draft.requirements)}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
        {save.error && <p className="error">{save.error.message}</p>}
      </header>

      <nav className="segmented pane-switch" aria-label="Panes">
        {PANES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={pane === value}
            className={pane === value ? "active" : undefined}
            onClick={() => setPane(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="workbench-panes">
        <div className="workbench-pane edit-pane">
          <div className="pane-heading">
            <div className="segmented" role="tablist" aria-label="Editor">
              {(
                [
                  ["visual", "Visual"],
                  ["json", "JSON"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  className={mode === value ? "active" : undefined}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {mode === "json" ? (
            <JsonEditor value={text} onChange={setText} problems={draft.kind === "invalid" ? draft.problems : []} />
          ) : draft.kind === "invalid" ? (
            <div className="visual-blocked">
              <p>The JSON has a problem, so it cannot be edited visually until it is fixed.</p>
              <button type="button" onClick={() => setMode("json")}>
                Fix the JSON
              </button>
            </div>
          ) : (
            <VisualEditor
              requirements={draft.requirements}
              saved={saved}
              onChange={(next) => setText(formatDocument(next))}
              rows={rows ?? []}
              drivers={driverList}
              workbench={workbench}
            />
          )}
        </div>

        <div className="workbench-pane ranking-pane">
          <div className="pane-heading">
            <h2>Ranking</h2>
            <span className="muted">
              {inPlay.length} in play
              {moved > 0 && ` · ${moved} moved`}
            </span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showRejected}
                onChange={(event) => setShowRejected(event.target.checked)}
              />
              Rejected
            </label>
          </div>
          {unread.length > 0 && (
            <AskBanner
              unread={unread.length}
              questions={unreadQuestions}
              asking={asking}
              onAsk={() => askAbout(unread)}
              onCancel={cancel}
            />
          )}
          {rows === null ? (
            <p className="muted">Ranking…</p>
          ) : (
            <Leaderboard
              rows={rows}
              selected={selected?.property.id ?? null}
              onSelect={(id) => {
                setChosen(id);
                setPane("why");
              }}
              showRejected={showRejected}
            />
          )}
        </div>

        <div className="workbench-pane why-pane">
          {rows !== null && (
            <Inspector
              rows={rows}
              selected={selected}
              drivers={driverList}
              requirements={current}
              answersOf={(row) =>
                matchingAnswers(draftPrints ?? new Map(), [
                  ...row.property.answers,
                  ...(asked.get(row.property.id) ?? []),
                ])
              }
              onSelect={setChosen}
              onAsk={asking.kind === "asking" ? null : (row) => askAbout([row])}
            />
          )}
        </div>
      </div>
    </section>
  );
};
