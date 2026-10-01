import type { BoroughProgress, WeekCount } from "../../../../contract";
import { formatCount, formatDate, formatPercent } from "../../../utils/format";
import { useStats } from "../api/stats";

const Fact = ({ label, value, detail }: { label: string; value: string; detail: string }) => (
  <div className="fact">
    <dt>{label}</dt>
    <dd className="numeric">{value}</dd>
    <dd className="muted">{detail}</dd>
  </div>
);

/** New streets per week, oldest on the left; the last bar is the week in progress. */
const WeeksChart = ({ weeks }: { weeks: readonly WeekCount[] }) => {
  const peak = Math.max(1, ...weeks.map((week) => week.streets));
  const first = weeks[0];
  return (
    <figure className="chart">
      <div
        className="bars"
        role="img"
        aria-label={`New streets per week: ${weeks.map((week) => `${week.week} ${week.streets}`).join(", ")}`}
      >
        {weeks.map((week) => (
          <div key={week.week} className="bar" title={`Week of ${formatDate(week.week)}: ${week.streets}`}>
            {week.streets > 0 && <span className="segment" style={{ height: `${(week.streets / peak) * 100}%` }} />}
          </div>
        ))}
      </div>
      {first && (
        <figcaption className="chart-axis muted numeric">
          <span>{formatDate(first.week)}</span>
          <span>peak {peak}/wk</span>
          <span>this week</span>
        </figcaption>
      )}
    </figure>
  );
};

const BoroughRow = ({ borough }: { borough: BoroughProgress }) => (
  <tr>
    <th scope="row">{borough.name}</th>
    <td className="numeric">
      {formatCount(borough.completed)}/{formatCount(borough.streets)}
    </td>
    <td className="numeric percent">
      <span className="meter" style={{ width: `${(borough.completed / Math.max(1, borough.streets)) * 100}%` }} />
      <span>{formatPercent(borough.completed, borough.streets)}</span>
    </td>
  </tr>
);

export const StatsPage = () => {
  const stats = useStats();
  if (stats.error) {
    return <p className="error">{stats.error.message}</p>;
  }
  if (stats.data === undefined) {
    return <p className="muted">Loading…</p>;
  }
  const { overall, boroughs, recent, weeks, streakWeeks } = stats.data;

  return (
    <section className="stats">
      <h1>London</h1>
      <dl className="facts">
        <Fact
          label="Streets"
          value={formatPercent(overall.completed, overall.streets)}
          detail={`${formatCount(overall.completed)} of ${formatCount(overall.streets)}`}
        />
        <Fact
          label="Nodes"
          value={formatPercent(overall.nodesHit, overall.nodes)}
          detail={`${formatCount(overall.nodesHit)} of ${formatCount(overall.nodes)}`}
        />
        <Fact
          label="Streak"
          value={`${streakWeeks} wk`}
          detail={streakWeeks === 1 ? "week with new streets" : "weeks running with new streets"}
        />
      </dl>

      <h2>New streets per week</h2>
      <WeeksChart weeks={weeks} />

      <h2>Recently completed</h2>
      {recent.length === 0 ? (
        <p className="muted">None yet. Connect Strava or upload a run to start.</p>
      ) : (
        <ul className="recent">
          {recent.map((street) => (
            <li key={street.id}>
              <strong>{street.name}</strong> <span className="muted">{street.borough}</span>
              <span className="muted">
                {formatDate(street.completedAt)}
                {street.activityName && ` · ${street.activityName}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2>Boroughs</h2>
      {boroughs.length === 0 ? (
        <p className="muted">No streets imported yet; see Connect.</p>
      ) : (
        <table className="boroughs">
          <thead>
            <tr>
              <th scope="col">Borough</th>
              <th scope="col">Streets</th>
              <th scope="col">Done</th>
            </tr>
          </thead>
          <tbody>
            {boroughs.map((borough) => (
              <BoroughRow key={borough.id} borough={borough} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
