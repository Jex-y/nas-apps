import { type PointerEvent, useState } from "react";
import type { NetWorthSeries } from "../../../../contract";
import { formatAxisMonth, formatCompact, formatDay, formatPence, KIND_LABELS } from "../../../utils/format";
import { useElementWidth } from "../hooks/useElementWidth";
import { heldKinds, monthStarts, niceTicks, totalOf } from "../utils/chart";

const HEIGHT = 260;
const MARGIN = { top: 12, right: 14, bottom: 26, left: 58 };
/** Room one month label needs, which sets how many fit. */
const MONTH_LABEL_WIDTH = 72;

/**
 * Total net worth over time as one line. Pointing at a day reads out its total and what made it up; a slider under
 * the chart does the same from the keyboard. The scale brackets the data rather than starting at zero, so it shows
 * change, not size.
 */
export const NetWorthChart = ({ series }: { readonly series: NetWorthSeries }) => {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const totals = series.map(totalOf);
  const ticks = niceTicks(Math.min(...totals), Math.max(...totals), 4);
  const [low, high] = [ticks[0] ?? 0, ticks.at(-1) ?? 1];
  const plot = { width: Math.max(0, width - MARGIN.left - MARGIN.right), height: HEIGHT - MARGIN.top - MARGIN.bottom };
  const x = (index: number) =>
    MARGIN.left + (series.length === 1 ? plot.width / 2 : (index / (series.length - 1)) * plot.width);
  const y = (value: number) => MARGIN.top + (1 - (value - low) / (high - low)) * plot.height;
  const path = totals.map((total, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(total).toFixed(1)}`);
  const last = series.length - 1;
  const shown = active === null ? undefined : series[active];

  const nearest = (event: PointerEvent<SVGSVGElement>) => {
    const offset = event.clientX - event.currentTarget.getBoundingClientRect().left - MARGIN.left;
    const index = Math.round((offset / Math.max(1, plot.width)) * last);
    setActive(Math.min(last, Math.max(0, index)));
  };
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Net worth from ${formatDay(series[0]?.date ?? "")} to ${formatDay(series[last]?.date ?? "")}, ending at ${formatPence(totals[last] ?? 0)}`}
          onPointerMove={nearest}
          onPointerDown={nearest}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
              <text className="tick" x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {formatCompact(tick)}
              </text>
            </g>
          ))}
          {monthStarts(
            series.map((point) => point.date),
            Math.floor(plot.width / MONTH_LABEL_WIDTH),
          ).map((index) => (
            <text key={index} className="tick" x={x(index)} y={HEIGHT - 6} textAnchor="middle">
              {formatAxisMonth(series[index]?.date ?? "")}
            </text>
          ))}
          {active !== null && (
            <line className="crosshair" x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + plot.height} />
          )}
          <path className="line" d={path.join("")} />
          <circle className="marker" cx={x(active ?? last)} cy={y(totals[active ?? last] ?? 0)} r={5} />
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
        aria-label="Day"
        aria-valuetext={`${formatDay(series[active ?? last]?.date ?? "")}: ${formatPence(totals[active ?? last] ?? 0)}`}
      />
      {active !== null && shown !== undefined && (
        <div
          className="chart-tooltip"
          style={x(active) > width / 2 ? { right: width - x(active) + 12 } : { left: x(active) + 12 }}
        >
          <time dateTime={shown.date}>{formatDay(shown.date)}</time>
          <strong>{formatPence(totalOf(shown))}</strong>
          <dl>
            {heldKinds(shown).map((kind) => (
              <div key={kind}>
                <dt>{KIND_LABELS[kind]}</dt>
                <dd>{formatPence(shown.byKind[kind])}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
};
