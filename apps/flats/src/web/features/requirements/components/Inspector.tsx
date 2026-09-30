import { useState } from "react";
import { Link } from "wouter";
import type { Answer, Requirements } from "../../../../contract";
import { formatPoints, formatPrice } from "../../../utils/format";
import { useProperty } from "../../properties/api/properties";
import { type Driver, type Explanation, explain, type Row } from "../utils/rank";
import { AnswerBars } from "./AnswerBars";
import { Beeswarm } from "./Beeswarm";
import { Waterfall } from "./Waterfall";

const Heading = ({ row }: { row: Row }) => (
  <header className="inspector-heading">
    {row.property.thumbnailUrl && <img className="inspector-photo" src={row.property.thumbnailUrl} alt="" />}
    <div>
      <h2>
        <Link href={`/properties/${row.property.id}`}>{row.property.address}</Link>
      </h2>
      <p className="muted">{formatPrice(row.property.price, row.property.priceQualifier)}</p>
    </div>
    {row.draft.kind === "scored" ? (
      <span className="inspector-standing">
        <span className="inspector-score">{formatPoints(row.draft.total)}</span>
        <span className="inspector-rank">
          {row.rank === null ? "Not ranked" : `Ranked ${row.rank}`}
          {row.savedRank !== null && row.savedRank !== row.rank && `, was ${row.savedRank}`}
        </span>
      </span>
    ) : (
      <span className="inspector-verdict">{row.draft.reason}</span>
    )}
  </header>
);

/** What Jev read, fetched only for the flat being inspected. */
const Listing = ({ propertyId }: { propertyId: string }) => {
  const property = useProperty(propertyId);
  if (property.data === undefined) {
    return <p className="muted">{property.error ? property.error.message : "Loading the listing…"}</p>;
  }
  return (
    <div className="listing-text">
      <p className="muted">{property.data.propertyType}</p>
      {property.data.keyFeatures.length > 0 && (
        <ul>
          {property.data.keyFeatures.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      )}
      <p className="prose">{property.data.description}</p>
    </div>
  );
};

const ThisFlat = ({
  row,
  explanation,
  requirements,
  answers,
  onAsk,
}: {
  row: Row;
  explanation: Explanation | null;
  requirements: Requirements;
  answers: ReadonlyMap<string, Answer>;
  onAsk: (() => void) | null;
}) => (
  <div className="inspector-body">
    <Heading row={row} />
    {row.draft.kind !== "scored" ? (
      <p className="inspector-note">
        {row.draft.kind === "limited" ? "A limit rules it out" : "Jev rules it out"} before it is scored:{" "}
        <strong>{row.draft.reason}</strong>.
      </p>
    ) : explanation === null ? null : (
      <section className="inspector-section">
        <h3>Why it scores {formatPoints(explanation.total)}</h3>
        <p className="muted">Each attribute against the average flat in play, largest effect first.</p>
        <Waterfall explanation={explanation} />
      </section>
    )}
    <section className="inspector-section">
      <div className="inspector-section-heading">
        <h3>What Jev read</h3>
        {onAsk !== null && (
          <button type="button" className="primary" onClick={onAsk}>
            Ask Jev about {row.unanswered.length === 1 ? "1 question" : `${row.unanswered.length} questions`}
          </button>
        )}
      </div>
      <ul className="inspector-answers">
        {requirements.questions.map((question) => (
          <li key={question.key}>
            <span className="inspector-answer-label">{question.label}</span>
            <AnswerBars question={question} answer={answers.get(question.key) ?? null} />
          </li>
        ))}
      </ul>
      <details className="inspector-listing">
        <summary>The listing</summary>
        <Listing propertyId={row.property.id} />
      </details>
    </section>
  </div>
);

type Tab = "flat" | "all";

export const Inspector = ({
  rows,
  selected,
  drivers,
  requirements,
  answersOf,
  onSelect,
  onAsk,
}: {
  rows: readonly Row[];
  selected: Row | null;
  drivers: readonly Driver[];
  requirements: Requirements;
  answersOf: (row: Row) => ReadonlyMap<string, Answer>;
  onSelect: (propertyId: string) => void;
  onAsk: ((row: Row) => void) | null;
}) => {
  const [tab, setTab] = useState<Tab>("flat");
  return (
    <div className="inspector">
      <div className="segmented" role="tablist" aria-label="Explain">
        {(
          [
            ["flat", "This flat"],
            ["all", "All flats"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "active" : undefined}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "all" ? (
        <div className="inspector-body">
          <section className="inspector-section">
            <h3>What drives the ranking</h3>
            <p className="muted">
              Each dot is a flat; how far it sits from the centre is how much that attribute moves its score against the
              average flat. Most influential first.
            </p>
            {drivers.length === 0 ? (
              <p className="muted">Nothing scores yet.</p>
            ) : (
              <Beeswarm drivers={drivers} rows={rows} selected={selected?.property.id ?? null} onSelect={onSelect} />
            )}
          </section>
        </div>
      ) : selected === null ? (
        <p className="muted inspector-empty">Choose a flat to see why it ranks where it does.</p>
      ) : (
        <ThisFlat
          row={selected}
          explanation={explain(selected, rows)}
          requirements={requirements}
          answers={answersOf(selected)}
          onAsk={
            onAsk !== null && selected.unanswered.length > 0 && selected.property.readable
              ? () => onAsk(selected)
              : null
          }
        />
      )}
    </div>
  );
};
