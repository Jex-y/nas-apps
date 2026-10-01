import { type PointerEvent, useState } from "react";
import { formatDay, formatKg, formatSet } from "../../../utils/format";
import { useElementWidth } from "../hooks/useElementWidth";
import { datePositions, niceTicks, type TrendPoint } from "../utils/chart";

const HEIGHT = 220;
const MARGIN = { top: 12, right: 14, bottom: 26, left: 44 };

/**
 * Estimated max over time as one line, a dot for each session. Pointing at a session reads out its estimate and the
 * set behind it; a slider under the chart does the same from the keyboard. The scale brackets the data rather than
 * starting at zero, so it shows change, not size.
 */
export const MaxChart = ({ points }: { readonly points: readonly TrendPoint[] }) => {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const values = points.map((point) => point.maxKg);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const [low, high] = [ticks[0] ?? 0, ticks.at(-1) ?? 1];
  const plot = { width: Math.max(0, width - MARGIN.left - MARGIN.right), height: HEIGHT - MARGIN.top - MARGIN.bottom };
  const xs = datePositions(points.map((point) => point.date)).map((position) => MARGIN.left + position * plot.width);
  const y = (value: number) => MARGIN.top + (1 - (value - low) / (high - low)) * plot.height;
  const path = points.map(
    (point, index) => `${index === 0 ? "M" : "L"}${(xs[index] ?? 0).toFixed(1)} ${y(point.maxKg).toFixed(1)}`,
  );
  const last = points.length - 1;
  const [first, latest] = [points[0], points[last]];
  const shown = active === null ? undefined : points[active];
  const shownX = active === null ? 0 : (xs[active] ?? 0);

  const nearest = (event: PointerEvent<SVGSVGElement>) => {
    const pointer = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const distances = xs.map((x) => Math.abs(x - pointer));
    setActive(distances.indexOf(Math.min(...distances)));
  };

  return (
    <div className="chart" ref={ref}>
      {width > 0 && first !== undefined && latest !== undefined && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Estimated max from ${formatDay(first.date)} to ${formatDay(latest.date)}, ending at ${formatKg(latest.maxKg)} kilograms`}
          onPointerMove={nearest}
          onPointerDown={nearest}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
              <text className="tick" x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {formatKg(tick)}
              </text>
            </g>
          ))}
          <text className="tick" x={MARGIN.left} y={HEIGHT - 6} textAnchor="start">
            {formatDay(first.date)}
          </text>
          {last > 0 && (
            <text className="tick" x={width - MARGIN.right} y={HEIGHT - 6} textAnchor="end">
              {formatDay(latest.date)}
            </text>
          )}
          {active !== null && (
            <line className="crosshair" x1={shownX} x2={shownX} y1={MARGIN.top} y2={MARGIN.top + plot.height} />
          )}
          <path className="line" d={path.join("")} />
          {points.map((point, index) => (
            <circle
              key={point.set.id}
              className={index === (active ?? last) ? "marker active" : "marker"}
              cx={xs[index]}
              cy={y(point.maxKg)}
              r={index === (active ?? last) ? 5 : 4}
            />
          ))}
        </svg>
      )}
      <input
        type="range"
        className="chart-scrub"
        min={0}
        max={last}
        value={active ?? last}
        onChange={(event) => setActive(Number(event.target.value))}
        onFocus={() => setActive((current) => current ?? last)}
        onBlur={() => setActive(null)}
        aria-label="Session"
        aria-valuetext={`${formatDay(points[active ?? last]?.date ?? "")}: ${formatKg(points[active ?? last]?.maxKg ?? 0)} kilograms`}
      />
      {shown !== undefined && (
        <div
          className="chart-tooltip"
          style={shownX > width / 2 ? { right: width - shownX + 12 } : { left: shownX + 12 }}
        >
          <time dateTime={shown.date}>{formatDay(shown.date)}</time>
          <strong>{formatKg(shown.maxKg)} kg</strong>
          <span className="muted numeric">from {formatSet(shown.set)}</span>
        </div>
      )}
    </div>
  );
};
