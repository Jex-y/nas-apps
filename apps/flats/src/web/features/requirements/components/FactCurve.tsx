import type { FactRule } from "../../../../contract";
import { FACTS, pointsFor } from "../../../../scoring";

const WIDTH = 320;
const HEIGHT = 120;
const PAD = { top: 10, right: 12, bottom: 22, left: 34 } as const;
const SAMPLES = 80;

const short = (value: number) =>
  Math.abs(value) >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : `${Number(value.toFixed(1))}`;

/**
 * How a fact rule turns a value into points, over the range the flats in play span, with a dot for each flat so the
 * effect of moving the line is visible where it matters.
 */
export const FactCurve = ({ rule, values }: { rule: FactRule; values: readonly number[] }) => {
  const low = Math.min(rule.from, ...values);
  const high = Math.max(rule.from, ...values);
  const spread = high - low || Math.max(1, Math.abs(rule.from) * 0.2);
  const xMin = low - spread * 0.06;
  const xMax = high + spread * 0.06;
  const samples = Array.from({ length: SAMPLES + 1 }, (_, index) => xMin + ((xMax - xMin) * index) / SAMPLES);
  const ys = [0, ...samples.map((x) => pointsFor(rule, x))];
  const yLow = Math.min(...ys);
  const yHigh = Math.max(...ys);
  const yPad = (yHigh - yLow || 1) * 0.15;
  const yMin = yLow - yPad;
  const yMax = yHigh + yPad;

  const px = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin)) * (WIDTH - PAD.left - PAD.right);
  const py = (y: number) => PAD.top + ((yMax - y) / (yMax - yMin)) * (HEIGHT - PAD.top - PAD.bottom);
  const line = samples.map((x) => `${px(x).toFixed(1)},${py(pointsFor(rule, x)).toFixed(1)}`).join(" ");
  const { unit, tick = short } = FACTS[rule.fact];

  return (
    <svg
      className="fact-curve"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Points for ${FACTS[rule.fact].label.toLowerCase()} from ${tick(xMin)} to ${tick(xMax)} ${unit}`}
    >
      <line className="curve-zero" x1={PAD.left} x2={WIDTH - PAD.right} y1={py(0)} y2={py(0)} />
      <line className="curve-from" x1={px(rule.from)} x2={px(rule.from)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
      <polyline className="curve-line" points={line} />
      {values.map((value, index) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: one dot per value; equal values overlap by design
          key={index}
          className={pointsFor(rule, value) >= 0 ? "curve-dot up" : "curve-dot down"}
          cx={px(value)}
          cy={py(pointsFor(rule, value))}
          r={3}
        />
      ))}
      <text className="curve-tick" x={PAD.left - 6} y={py(yHigh) + 3} textAnchor="end">
        {yHigh > 0 ? `+${short(yHigh)}` : short(yHigh)}
      </text>
      <text className="curve-tick" x={PAD.left - 6} y={py(yLow) + 3} textAnchor="end">
        {short(yLow)}
      </text>
      <text className="curve-tick" x={PAD.left} y={HEIGHT - 6} textAnchor="start">
        {tick(xMin)}
      </text>
      <text className="curve-tick" x={px(rule.from)} y={HEIGHT - 6} textAnchor="middle">
        {tick(rule.from)}
      </text>
      <text className="curve-tick" x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end">
        {tick(xMax)} {unit}
      </text>
    </svg>
  );
};
