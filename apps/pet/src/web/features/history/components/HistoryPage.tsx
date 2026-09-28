import type { HistoryDay } from "../../../../contract";
import { formatCount, formatDay, formatWeekday } from "../../../utils/format";
import { useHistory } from "../api/history";

const BAR = 20;
const HEIGHT = 120;
const LABELS = 14;

const barClass = (day: HistoryDay, isToday: boolean): string =>
  ["bar", day.fed === null ? "unborn" : day.fed ? "fed" : "missed", isToday ? "today" : ""].join(" ").trim();

/** Steps a day against the goal line; fed days are solid, missed ones hollow. */
const StepsChart = ({ days }: { days: readonly HistoryDay[] }) => {
  const top = Math.max(...days.map((day) => Math.max(day.steps ?? 0, day.goal * 1.2)));
  const y = (steps: number) => HEIGHT - (steps / top) * HEIGHT;
  const goalPath = days.map((day, index) => `${index === 0 ? "M" : "L"}${index * BAR} ${y(day.goal)}h${BAR}`).join("");

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${days.length * BAR} ${HEIGHT + LABELS}`}
      role="img"
      aria-label="Steps per day"
    >
      {days.map((day, index) => (
        <g key={day.date}>
          <title>{`${formatDay(day.date)}: ${day.steps === null ? "no data" : `${formatCount(day.steps)} steps`}`}</title>
          <rect
            className={barClass(day, index === days.length - 1)}
            x={index * BAR + 3}
            y={y(day.steps ?? 0)}
            width={BAR - 6}
            height={HEIGHT - y(day.steps ?? 0)}
          />
          <text x={index * BAR + BAR / 2} y={HEIGHT + LABELS - 2} textAnchor="middle">
            {formatWeekday(day.date)}
          </text>
        </g>
      ))}
      <path className="goal-line" d={goalPath} />
    </svg>
  );
};

export const HistoryPage = () => {
  const history = useHistory();

  if (history.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (history.error) {
    return <p className="error">{history.error.message}</p>;
  }
  const days = history.data;
  const fed = days.filter((day) => day.fed).length;
  const walked = days.reduce((total, day) => total + (day.steps ?? 0), 0);

  return (
    <section className="panel">
      <h1>Last two weeks</h1>
      <p className="muted">
        Fed on {fed} of {days.length} days, {formatCount(walked)} steps in all. The dashed line is the goal.
      </p>
      <StepsChart days={days} />
      <ul className="days">
        {days.toReversed().map((day) => (
          <li key={day.date}>
            <span>{formatDay(day.date)}</span>
            <span className="numeric">{day.steps === null ? "–" : formatCount(day.steps)}</span>
            <span className={day.fed ? "fed-mark" : "muted"}>
              {day.fed === null ? "" : day.fed ? "Fed" : `Goal ${formatCount(day.goal)}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};
