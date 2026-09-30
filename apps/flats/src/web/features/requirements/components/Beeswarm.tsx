import type { CSSProperties } from "react";
import { formatPoints } from "../../../utils/format";
import type { Driver, Row } from "../utils/rank";
import { symmetricScale, ticks } from "../utils/scale";

/** Dots nearer than this share a lane; in percent of the track, about a dot's width on a phone. */
const CLEARANCE = 2.6;
const MAX_LANES = 5;
/** Below this an effect barely moves a score, so a dot reads as neutral and an attribute as not mattering. */
const NEUTRAL = 0.05;

type Dot = { readonly row: Row; readonly shap: number; readonly detail: string; readonly x: number };

/** A lane for each dot, so ones that would overlap stack either side of the row's centre line. */
const stack = (dots: readonly Dot[]): { readonly count: number; readonly laneOf: ReadonlyMap<Dot, number> } => {
  const { ends, laneOf } = dots
    .toSorted((a, b) => a.x - b.x)
    .reduce(
      (placed, dot) => {
        const free = placed.ends.findIndex((lastX) => dot.x - lastX >= CLEARANCE);
        const lane = free === -1 ? Math.min(placed.ends.length, MAX_LANES - 1) : free;
        return {
          ends: lane === placed.ends.length ? [...placed.ends, dot.x] : placed.ends.with(lane, dot.x),
          laneOf: new Map(placed.laneOf).set(dot, lane),
        };
      },
      { ends: [] as number[], laneOf: new Map<Dot, number>() },
    );
  return { count: Math.max(1, ends.length), laneOf };
};

/** Lane 0 on the centre line, then 1 above, 2 below, 3 above… */
const offset = (lane: number) => (lane === 0 ? 0 : (lane % 2 === 1 ? -1 : 1) * Math.ceil(lane / 2));

export const Beeswarm = ({
  drivers,
  rows,
  selected,
  onSelect,
}: {
  drivers: readonly Driver[];
  rows: readonly Row[];
  selected: string | null;
  onSelect: (propertyId: string) => void;
}) => {
  const moving = drivers.filter((driver) => driver.importance >= NEUTRAL);
  const idle = drivers.filter((driver) => driver.importance < NEUTRAL);
  const scale = symmetricScale(moving.flatMap((driver) => [...driver.points.values()].map(({ shap }) => shap)));
  const byId = new Map(rows.map((row) => [row.property.id, row]));

  return (
    <figure className="beeswarm" aria-label="What moves each flat's score, attribute by attribute">
      {moving.map((driver) => {
        const dots: Dot[] = [...driver.points].flatMap(([id, { shap, detail }]) => {
          const row = byId.get(id);
          return row === undefined ? [] : [{ row, shap, detail, x: scale.at(shap) }];
        });
        const { count: lanes, laneOf } = stack(dots);
        return (
          <div key={driver.key} className="beeswarm-row" style={{ "--lanes": lanes } as CSSProperties}>
            <span className="beeswarm-label">
              <span>{driver.label}</span>
              <span className="beeswarm-source">{driver.source === "jev" ? "Jev" : "Fact"}</span>
            </span>
            <span className="beeswarm-track">
              <span className="beeswarm-zero" style={{ left: `${scale.at(0)}%` }} />
              {dots.map((dot) => {
                const direction = Math.abs(dot.shap) < NEUTRAL ? "neutral" : dot.shap > 0 ? "up" : "down";
                const isSelected = dot.row.property.id === selected;
                return (
                  <button
                    key={dot.row.property.id}
                    type="button"
                    className={`beeswarm-dot ${direction}${isSelected ? " selected" : ""}`}
                    style={{ left: `${dot.x}%`, "--offset": offset(laneOf.get(dot) ?? 0) } as CSSProperties}
                    title={`${dot.row.property.address}: ${formatPoints(dot.shap)} (${dot.detail})`}
                    aria-label={`${dot.row.property.address}, ${driver.label} ${formatPoints(dot.shap)}`}
                    aria-pressed={isSelected}
                    onClick={() => onSelect(dot.row.property.id)}
                  />
                );
              })}
            </span>
            <span className="beeswarm-importance" title="Moves a score this much on average">
              ±{driver.importance.toFixed(1)}
            </span>
          </div>
        );
      })}
      {idle.length > 0 && (
        <p className="beeswarm-idle muted">
          {idle.map((driver) => driver.label).join(", ")} {idle.length === 1 ? "barely moves" : "barely move"} any
          score.
        </p>
      )}
      <div className="beeswarm-row beeswarm-axis" aria-hidden="true">
        <span className="beeswarm-caption">Lowers ← score → raises</span>
        <span className="beeswarm-track">
          {ticks(scale, 4).map((tick) => (
            <span key={tick} className="beeswarm-tick" style={{ left: `${scale.at(tick)}%` }}>
              {tick > 0 ? `+${tick}` : tick}
            </span>
          ))}
        </span>
        <span />
      </div>
    </figure>
  );
};
