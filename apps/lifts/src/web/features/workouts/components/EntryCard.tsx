import { useState } from "react";
import { Link } from "wouter";
import type { EntryDetail, Session } from "../../../../log";
import { bestEstimate } from "../../../../strength";
import { formatDay, formatKg, formatSet } from "../../../utils/format";
import type { WorkoutActions } from "../api/workouts";
import { nextSet } from "../utils/prefill";
import { SetRow } from "./SetRow";

type Props = {
  readonly entry: EntryDetail;
  /** The exercise's previous session, to lift against. */
  readonly lastTime: Session | null;
  readonly actions: WorkoutActions;
};

export const EntryCard = ({ entry, lastTime, actions }: Props) => {
  const [notes, setNotes] = useState(entry.notes);
  const best = bestEstimate(entry.sets);
  const next = nextSet(entry, lastTime);

  return (
    <section className="card entry">
      <header className="entry-heading">
        <h2>
          <Link href={`/exercises/${entry.exerciseId}`}>{entry.exercise.name}</Link>
        </h2>
        {best !== null && <span className="muted numeric">est. max {formatKg(best.maxKg)} kg</span>}
        <button
          type="button"
          className="quiet"
          aria-label={`Remove ${entry.exercise.name}`}
          onClick={() => {
            if (entry.sets.length === 0 || confirm(`Remove ${entry.exercise.name} and its sets?`)) {
              actions.removeEntry(entry);
            }
          }}
        >
          ×
        </button>
      </header>
      {lastTime !== null && (
        <p className="muted last-time">
          {formatDay(lastTime.workout.date)}:{" "}
          <span className="numeric">{lastTime.sets.map(formatSet).join(" · ")}</span>
        </p>
      )}
      <ol className="sets">
        {entry.sets.map((set, index) => (
          <SetRow key={set.id} set={set} number={index + 1} actions={actions} />
        ))}
      </ol>
      <button type="button" className="primary add-set" onClick={() => actions.addSet(entry, next)}>
        Add set <span className="numeric">{formatSet(next)}</span>
      </button>
      <textarea
        rows={1}
        value={notes}
        placeholder="Notes"
        aria-label={`Notes on ${entry.exercise.name}`}
        maxLength={10_000}
        onChange={(event) => setNotes(event.target.value)}
        onBlur={() => notes !== entry.notes && actions.updateEntry(entry, notes)}
      />
    </section>
  );
};
