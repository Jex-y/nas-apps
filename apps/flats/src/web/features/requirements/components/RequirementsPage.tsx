import { useMemo, useState } from "react";
import type { Requirements } from "../../../../contract";
import { STATUS_LABELS } from "../../../utils/format";
import { useProperties } from "../../properties/api/properties";
import { useRequirements, useSaveRequirements, useTrial } from "../api/requirements";
import { useDebounced } from "../hooks/useDebounced";
import { formatDocument, parseDraft } from "../utils/draft";
import { JsonEditor } from "./JsonEditor";
import { TrialPanel } from "./TrialPanel";

/** The saved requirements as JSON, tried live against a sample flat as they are edited, like Jev's playground. */
export const RequirementsPage = () => {
  const saved = useRequirements();
  if (saved.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (saved.error) {
    return <p className="error">{saved.error.message}</p>;
  }
  return <Playground saved={saved.data} />;
};

const Playground = ({ saved }: { saved: Requirements }) => {
  const [text, setText] = useState(() => formatDocument(saved));
  const draft = useMemo(() => parseDraft(text), [text]);
  const settled = useDebounced(draft.kind === "valid" ? draft.requirements : null, 600);

  const properties = useProperties("all");
  const [chosen, setChosen] = useState<string | null>(null);
  const samples = properties.data ?? [];
  const sampleId = chosen ?? samples.find((property) => property.status === "new")?.id ?? samples[0]?.id ?? null;
  const trial = useTrial(settled, sampleId);

  const save = useSaveRequirements();
  const dirty = draft.kind === "valid" && formatDocument(draft.requirements) !== formatDocument(saved);

  return (
    <section>
      <div className="page-heading">
        <h1>Requirements</h1>
        <div className="actions">
          <button
            type="button"
            disabled={text === formatDocument(saved)}
            onClick={() => setText(formatDocument(saved))}
          >
            Revert
          </button>
          <button
            type="button"
            className="primary"
            disabled={!dirty || save.isPending}
            onClick={() => draft.kind === "valid" && save.mutate(draft.requirements)}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <p className="muted">
        Limits reject a flat from its listing's facts; <code>null</code> turns one off. Exclusions reject it when Jev is
        sure; the rest score it. Saving re-judges every untriaged flat and asks Jev whatever is reworded.
      </p>
      {save.error && <p className="error">{save.error.message}</p>}

      <div className="playground">
        <div className="editor-pane">
          <JsonEditor value={text} onChange={setText} />
          {draft.kind === "invalid" && (
            <ul className="problems">
              {draft.problems.map((problem) => (
                <li key={problem} className="error">
                  {problem}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="results-pane">
          <label className="sample">
            Try on{" "}
            <select value={sampleId ?? ""} onChange={(event) => setChosen(event.target.value)}>
              {samples.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.address} · {STATUS_LABELS[property.status]}
                </option>
              ))}
            </select>
          </label>
          {samples.length === 0 && <p className="muted">No flats to try yet. Add a search first.</p>}
          {trial.error && <p className="error">{trial.error.message}</p>}
          {trial.data && (
            <TrialPanel
              trial={trial.data.trial}
              draft={trial.data.draft}
              stale={trial.isFetching || trial.isPlaceholderData || draft.kind === "invalid"}
            />
          )}
          {trial.isPending && sampleId !== null && settled !== null && <p className="muted">Asking Jev…</p>}
        </div>
      </div>
    </section>
  );
};
