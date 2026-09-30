import type { CSSProperties, ReactNode } from "react";
import { formatPoints } from "../../../utils/format";
import type { Effect, Explanation } from "../utils/rank";
import { type Scale, scaleOver, ticks } from "../utils/scale";

/** Beyond this many, the smallest effects share one row, as SHAP's waterfall does. */
const SHOWN = 8;
/** Smaller than this, an effect rounds to nothing and reads as neutral. */
const NEUTRAL = 0.05;
/** A label past this share of the track would run off its edge, so it goes on the other side. */
const EDGE = 82;

type Step = { readonly key: string; readonly label: string; readonly detail: string; readonly shap: number };

const steps = (effects: readonly Effect[]): Step[] => {
  const shown = effects.slice(0, SHOWN);
  const rest = effects.slice(SHOWN);
  return rest.length === 0
    ? shown
    : [
        ...shown,
        {
          key: "rest",
          label: `${rest.length} more`,
          detail: "Smaller effects together",
          shap: rest.reduce((sum, effect) => sum + effect.shap, 0),
        },
      ];
};

/** Beside the span `[low, high]`, on whichever side keeps the label on the track. */
const beside = (scale: Scale, low: number, high: number, prefer: "after" | "before"): CSSProperties => {
  const after = { left: `${scale.at(high)}%` };
  const before = { right: `${100 - scale.at(low)}%` };
  if (prefer === "after") {
    return scale.at(high) > EDGE ? before : after;
  }
  return scale.at(low) < 100 - EDGE ? after : before;
};

const Track = ({ scale, children }: { scale: Scale; children: ReactNode }) => (
  <span className="waterfall-track">
    {scale.min < 0 && scale.max > 0 && <span className="waterfall-zero" style={{ left: `${scale.at(0)}%` }} />}
    {children}
  </span>
);

const Anchor = ({
  label,
  value,
  scale,
  total = false,
}: {
  label: string;
  value: number;
  scale: Scale;
  total?: boolean;
}) => (
  <div className={total ? "waterfall-row waterfall-anchor waterfall-total" : "waterfall-row waterfall-anchor"}>
    <span className="waterfall-label">
      <span>{label}</span>
    </span>
    <Track scale={scale}>
      <span className="waterfall-marker" style={{ left: `${scale.at(value)}%` }} />
      <span className="waterfall-value" style={beside(scale, value, value, "after")}>
        {formatPoints(value)}
      </span>
    </Track>
  </div>
);

/**
 * Why one flat scores what it does, starting from the average flat in play: each attribute pushes the score up or down
 * by its SHAP value, largest first, and the last row lands on the flat's score.
 */
export const Waterfall = ({ explanation }: { explanation: Explanation }) => {
  const rows = steps(explanation.effects);
  const ends = rows.map((_, index) =>
    rows.slice(0, index + 1).reduce((total, row) => total + row.shap, explanation.base),
  );
  const scale = scaleOver([explanation.base, ...ends], { withZero: false, padding: 0.12 });

  return (
    <figure className="waterfall" aria-label="How this flat's score builds up from the average flat">
      <Anchor label="Average flat" value={explanation.base} scale={scale} />
      {rows.map((row, index) => {
        const from = ends[index - 1] ?? explanation.base;
        const to = ends[index] ?? from;
        const low = Math.min(from, to);
        const high = Math.max(from, to);
        const direction = Math.abs(row.shap) < NEUTRAL ? "flat" : row.shap > 0 ? "up" : "down";
        return (
          <div key={row.key} className={`waterfall-row ${direction}`}>
            <span className="waterfall-label">
              <span>{row.label}</span>
              <span className="muted">{row.detail}</span>
            </span>
            <Track scale={scale}>
              <span
                className="waterfall-bar"
                style={{ left: `${scale.at(low)}%`, width: `${Math.max(0.5, scale.at(high) - scale.at(low))}%` }}
              />
              <span className="waterfall-value" style={beside(scale, low, high, row.shap >= 0 ? "after" : "before")}>
                {formatPoints(row.shap)}
              </span>
            </Track>
          </div>
        );
      })}
      <Anchor label="This flat" value={explanation.total} scale={scale} total />
      <div className="waterfall-row waterfall-axis" aria-hidden="true">
        <span />
        <Track scale={scale}>
          {ticks(scale).map((tick) => (
            <span key={tick} className="waterfall-tick" style={{ left: `${scale.at(tick)}%` }}>
              {tick}
            </span>
          ))}
        </Track>
      </div>
    </figure>
  );
};
