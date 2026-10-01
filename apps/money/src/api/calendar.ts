/** Balances are kept by the household's calendar day, across daylight saving changes. */
const ZONE = "Europe/London";

/** en-CA formats dates as `YYYY-MM-DD`. */
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const londonDate = (at: Date): string => dateFormat.format(at);

const DAY_MS = 86_400_000;

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** The same day `months` earlier, or that month's last day when it has no such day. */
export const monthsBefore = (date: string, months: number): string => {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
};
