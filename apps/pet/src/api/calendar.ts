/**
 * The pet lives on London time: its days, its bedtime and its nudges all follow the owner's wall clock, across
 * daylight saving changes. Dates are `YYYY-MM-DD` strings, compared as strings and stepped as whole calendar days.
 */
const ZONE = "Europe/London";
const DAY_MS = 24 * 60 * 60_000;

/** en-CA formats dates as `YYYY-MM-DD`. */
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "numeric", hourCycle: "h23" });

export const londonDate = (at: Date): string => dateFormat.format(at);

export const londonHour = (at: Date): number => Number(hourFormat.format(at));

/** Midnight UTC stands in for the date, so the arithmetic never sees a 23- or 25-hour day. */
const epochDay = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

export const addDays = (date: string, days: number): string =>
  new Date((epochDay(date) + days) * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string): number => epochDay(to) - epochDay(from);
