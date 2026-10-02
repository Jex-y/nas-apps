import { useState } from "react";
import { Link } from "wouter";
import { LiftSet } from "../../../../contract";
import type { EntryDetail, Session } from "../../../../log";
import { bestEstimate, isRecord } from "../../../../strength";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { NumberCell } from "../../../components/NumberCell";
import { formatKg, formatSet } from "../../../utils/format";
import type { WorkoutActions } from "../api/workouts";
import { doneRows, type Intent, NO_INTENT, openRows, type Row, type SetValues, withChange } from "../utils/plan";

type Props = {
  readonly entry: EntryDetail;
  /** The exercise's previous session, whose sets are laid out to do again. */
  readonly lastTime: Session | null;
  /** Every set of the exercise in other workouts, for spotting a record. */
  readonly before: readonly LiftSet[];
  /** Whether the workout is under way; a finished one shows only what was done. */
  readonly underWay: boolean;
  /** The set whose RPE is being asked for, anywhere in the workout. */
  readonly ratingId: string | null;
  /** Asks how hard a set was, or with `null` stops asking. */
  readonly onAsk: (setId: string | null) => void;
  readonly actions: WorkoutActions;
};

const valuesOf = ({ weightKg, reps, rpe, kind }: LiftSet): SetValues => ({ weightKg, reps, rpe, kind });

export const EntryCard = ({ entry, lastTime, before, underWay, ratingId, onAsk, actions }: Props) => {
  const [intent, setIntent] = useState<Intent>(NO_INTENT);
  const [notes, setNotes] = useState(entry.notes);

  const template = lastTime?.sets ?? [];
  const rows = underWay ? openRows(entry.sets, template, intent) : doneRows(entry.sets, template);
  const best = bestEstimate(entry.sets);
  const values = (row: Row): SetValues => (row.kind === "logged" ? valuesOf(row.set) : row.values);

  const change = (row: Row, patch: Partial<SetValues>) => {
    if (row.kind === "logged") {
      actions.updateSet(row.set, patch);
    } else {
      setIntent(withChange(rows, intent, row.index, patch));
    }
  };
  const tick = (row: Row) => {
    if (row.kind === "planned") {
      const id = actions.addSet(entry, row.values, row.index);
      onAsk(row.values.kind === "work" ? id : null);
      return;
    }
    // Unticked, the set goes back to being one still to do, as it was lifted.
    actions.removeSet(row.set);
    setIntent({ ...intent, changes: new Map(intent.changes).set(row.index, { ...valuesOf(row.set), rpe: null }) });
    onAsk(null);
  };
  const addRow = () => {
    const last = rows.at(-1);
    if (underWay) {
      setIntent({ ...intent, extra: rows.length - template.length + 1 });
    } else {
      actions.addSet(entry, last === undefined ? { weightKg: 20, reps: 5, rpe: null, kind: "work" } : values(last));
    }
  };

  return (
    <section className="card entry">
      <header className="entry-heading">
        <h2>
          <Link href={`/exercises/${entry.exerciseId}`}>{entry.exercise.name}</Link>
        </h2>
        {best !== null && (
          <span className="figure">
            <span className="label">Est. max</span>
            <span className="numeric">{formatKg(best.maxKg)}</span>
          </span>
        )}
      </header>

      {rows.length > 0 && (
        <div className="set-row set-columns label" aria-hidden="true">
          <span>Set</span>
          <span>Last time</span>
          <span>kg</span>
          <span>Reps</span>
          <span>RPE</span>
          <span />
        </div>
      )}
      <ol className="sets">
        {rows.map((row) => {
          const { weightKg, reps, rpe, kind } = values(row);
          const number = row.index + 1;
          const done = row.kind === "logged";
          const record = done && isRecord(row.set, before);
          return (
            <li key={done ? row.set.id : `to-do-${row.index}`}>
              <div className={["set-row", done ? "done" : "to-do", kind === "warmup" ? "warmup" : ""].join(" ")}>
                <button
                  type="button"
                  className="set-number numeric"
                  aria-label={`Set ${number}: ${kind === "warmup" ? "warm-up" : "work"} set. Tap to change`}
                  onClick={() => change(row, { kind: kind === "warmup" ? "work" : "warmup" })}
                >
                  {kind === "warmup" ? "W" : number}
                </button>
                <span className="set-previous numeric">
                  {record ? <span className="pr">PR</span> : row.previous === null ? "–" : formatSet(row.previous)}
                </span>
                <NumberCell
                  value={weightKg}
                  schema={LiftSet.shape.weightKg}
                  label={`Set ${number} weight in kilograms`}
                  inputMode="decimal"
                  onCommit={(next) => change(row, { weightKg: next })}
                />
                <NumberCell
                  value={reps}
                  schema={LiftSet.shape.reps}
                  label={`Set ${number} reps`}
                  inputMode="numeric"
                  onCommit={(next) => change(row, { reps: next })}
                />
                <button
                  type="button"
                  className="set-rpe numeric"
                  disabled={!done || kind === "warmup"}
                  aria-label={`Set ${number} RPE${rpe === null ? "" : ` ${rpe}`}`}
                  aria-expanded={done && ratingId === row.set.id}
                  onClick={() => done && onAsk(ratingId === row.set.id ? null : row.set.id)}
                >
                  {rpe ?? (done && kind === "work" ? "+" : "")}
                </button>
                <button
                  type="button"
                  className="tick"
                  aria-pressed={done}
                  aria-label={done ? `Set ${number} done. Tap to undo` : `Mark set ${number} done`}
                  onClick={() => tick(row)}
                >
                  <Icon name="check" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="entry-footer">
        <button type="button" className="add-set" onClick={addRow}>
          <Icon name="plus" />
          Add set
        </button>
        <input
          value={notes}
          placeholder="Note"
          aria-label={`Notes on ${entry.exercise.name}`}
          maxLength={10_000}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => notes !== entry.notes && actions.updateEntry(entry, notes)}
        />
        <ConfirmButton className="quiet-link" confirm="Remove it?" onConfirm={() => actions.removeEntry(entry)}>
          Remove
        </ConfirmButton>
      </footer>
    </section>
  );
};
