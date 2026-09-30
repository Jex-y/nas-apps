import type { CrimeSummary } from "../../../../contract";
import { categoryName, crimePeriod } from "../utils/crime";

const SHOWN = 5;

const perMonth = (count: number, months: number) => {
  const rate = count / months;
  return rate < 1 ? "under 1" : Math.round(rate).toLocaleString("en-GB");
};

/** How much street crime the police recorded near the flat, and what kind. */
export const CrimeSection = ({ crime }: { crime: CrimeSummary }) => {
  const categories = Object.entries(crime.byCategory).toSorted(([, a], [, b]) => b - a);
  const top = categories[0]?.[1] ?? 1;
  return (
    <section className="crime">
      <h2>Crime nearby</h2>
      <p className="crime-headline">
        <strong>{Math.round(crime.perMonth).toLocaleString("en-GB")}</strong> a month within {crime.radiusMetres} m
      </p>
      <p className="muted crime-period">{crimePeriod(crime.throughMonth, crime.months)}</p>
      <ul className="crime-categories" aria-label="The commonest kinds, a month">
        <li className="crime-categories-heading" aria-hidden="true">
          <span />
          <span>a month</span>
        </li>
        {categories.slice(0, SHOWN).map(([category, count]) => (
          <li key={category}>
            <span className="crime-category">{categoryName(category)}</span>
            <span className="crime-bar" aria-hidden="true">
              <span style={{ inlineSize: `${(count / top) * 100}%` }} />
            </span>
            <span className="crime-count">{perMonth(count, crime.months)}</span>
          </li>
        ))}
      </ul>
      <p className="muted crime-note">
        Street-level crime from police.uk, placed at the nearest of a set of map points, so a count is approximate.
      </p>
    </section>
  );
};
