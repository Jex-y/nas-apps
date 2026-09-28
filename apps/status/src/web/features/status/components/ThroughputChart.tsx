import type { HourlyOutcomes } from "../../../../contract";
import { formatCount, formatHour } from "../utils/format";

const SERIES = [
  ["completed", "completed"],
  ["retrying", "retried"],
  ["dead", "died"],
] as const;

const total = (hour: HourlyOutcomes): number => hour.completed + hour.retrying + hour.dead;

const describe = (hour: HourlyOutcomes): string =>
  `${formatHour(hour.hour)}: ${SERIES.map(([key, label]) => `${hour[key]} ${label}`).join(", ")}`;

/** Job attempts per UTC hour, stacked by how they ended; the last bar is the hour in progress. */
export const ThroughputChart = ({ hourly }: { readonly hourly: readonly HourlyOutcomes[] }) => {
  const peak = Math.max(1, ...hourly.map(total));
  const first = hourly[0];
  const last = hourly.at(-1);

  return (
    <figure className="chart">
      <div className="chart-legend muted">
        {SERIES.map(([key, label]) => (
          <span key={key}>
            <span className={`swatch ${key}`} /> {label}
          </span>
        ))}
        <span className="figure push">peak {formatCount(peak)}/h</span>
      </div>
      <div className="bars" role="img" aria-label={`Job attempts per hour: ${hourly.map(describe).join("; ")}`}>
        {hourly.map((hour) => (
          <div key={hour.hour} className="bar" title={describe(hour)}>
            {SERIES.map(([key]) =>
              hour[key] === 0 ? null : (
                <span key={key} className={`segment ${key}`} style={{ height: `${(hour[key] / peak) * 100}%` }} />
              ),
            )}
          </div>
        ))}
      </div>
      {first && last && (
        <figcaption className="chart-axis muted figure">
          <span>{formatHour(first.hour)}</span>
          <span>now</span>
        </figcaption>
      )}
    </figure>
  );
};
