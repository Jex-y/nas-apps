import { useState } from "react";
import { Link } from "wouter";
import type { LiftSet } from "../../../../contract";
import type { EntryDetail, Session } from "../../../../log";
import { bestEstimate, estimatedMax, isWorkSet } from "../../../../strength";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { formatDay, formatKg, formatSet } from "../../../utils/format";
import type { WorkoutActions } from "../api/workouts";
import { nextSet, type SetValues } from "../utils/prefill";
import { RestTimer } from "./RestTimer";
import { SetComposer } from "./SetComposer";

type Props = {
  readonly entry: EntryDetail;
  /** The exercise's previous session, to lift against. */
  readonly lastTime: Session | null;
  /** The one exercise being logged; the others fold down to their sets. */
  readonly active: boolean;
  readonly onActivate: () => void;
  /** When the workout's latest set was logged, for the rest clock; `null` once the workout is finished. */
  readonly restingSince: string | null;
  readonly actions: WorkoutActions;
};

const valuesOf = ({ weightKg, reps, rpe, kind }: LiftSet): SetValues => ({ weightKg, reps, rpe, kind });

export const EntryCard = ({ entry, lastTime, active, onActivate, restingSince, actions }: Props) => {
  const [draft, setDraft] = useState(() => nextSet(entry, lastTime));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notes, setNotes] = useState(entry.notes);

  const editing = entry.sets.find((set) => set.id === editingId) ?? null;
  const best = bestEstimate(entry.sets);
  const stopEditing = () => {
    setEditingId(null);
    setDraft(nextSet(entry, lastTime));
  };
  const edit = (set: LiftSet) => {
    onActivate();
    setEditingId(set.id);
    setDraft(valuesOf(set));
  };
  const submit = () => {
    if (editing === null) {
      actions.addSet(entry, draft);
      setDraft({ ...draft, rpe: null });
    } else {
      actions.updateSet(editing, draft);
      stopEditing();
    }
  };

  return (
    <section className={active ? "card entry active" : "card entry"}>
      <header className="entry-heading">
        <button type="button" className="entry-name" aria-expanded={active} onClick={onActivate}>
          {entry.exercise.name}
        </button>
        {best !== null && (
          <span className="figure">
            <span className="label">Est. max</span>
            <span className="numeric">{formatKg(best.maxKg)}</span>
          </span>
        )}
      </header>

      {lastTime !== null && (
        <p className="last-time">
          <span className="label">Last · {formatDay(lastTime.workout.date)}</span>
          <span className="numeric">{lastTime.sets.filter(isWorkSet).map(formatSet).join("  ·  ")}</span>
        </p>
      )}

      {entry.sets.length > 0 && (
        <div className="set-columns label" aria-hidden="true">
          <span>Set</span>
          <span>Weight</span>
          <span>Reps</span>
          <span>RPE</span>
          <span className="set-max">e1RM</span>
        </div>
      )}
      {entry.sets.length > 0 && (
        <ol className="sets">
          {entry.sets.map((set, index) => {
            const maxKg = isWorkSet(set) ? estimatedMax(set) : null;
            return (
              <li key={set.id}>
                <button
                  type="button"
                  className={[
                    "set",
                    isWorkSet(set) ? "" : "warmup",
                    set.id === editingId && active ? "selected" : "",
                  ].join(" ")}
                  aria-label={`Set ${index + 1}: ${formatSet(set)}${isWorkSet(set) ? "" : ", warm-up"}. Tap to correct`}
                  onClick={() => edit(set)}
                >
                  <span className="set-number numeric">{isWorkSet(set) ? index + 1 : "W"}</span>
                  <span className="set-weight numeric">
                    {formatKg(set.weightKg)}
                    <small>kg</small>
                  </span>
                  <span className="set-reps numeric">
                    <small>×</small>
                    {set.reps}
                  </span>
                  <span className="set-rpe numeric">{set.rpe === null ? "" : `@${set.rpe}`}</span>
                  <span className="set-max numeric">{maxKg === null ? "" : formatKg(maxKg)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {active && (
        <>
          <RestTimer since={restingSince} />
          <SetComposer
            draft={draft}
            onDraft={setDraft}
            number={editing === null ? entry.sets.length + 1 : entry.sets.indexOf(editing) + 1}
            editing={
              editing === null
                ? null
                : {
                    onCancel: stopEditing,
                    onDelete: () => {
                      actions.removeSet(editing);
                      stopEditing();
                    },
                  }
            }
            onSubmit={submit}
          />
          <footer className="entry-footer">
            <input
              value={notes}
              placeholder="Add a note"
              aria-label={`Notes on ${entry.exercise.name}`}
              maxLength={10_000}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => notes !== entry.notes && actions.updateEntry(entry, notes)}
            />
            <Link href={`/exercises/${entry.exerciseId}`} className="quiet-link">
              History
            </Link>
            <ConfirmButton className="quiet-link" confirm="Remove it?" onConfirm={() => actions.removeEntry(entry)}>
              Remove
            </ConfirmButton>
          </footer>
        </>
      )}
      {!active && entry.notes !== "" && <p className="muted">{entry.notes}</p>}
    </section>
  );
};
