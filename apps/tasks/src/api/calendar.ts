import { type Day, dayOfDate } from "../plan";

/** Reminders follow the household's wall clock, across daylight saving changes. */
const ZONE = "Europe/London";

/** en-CA formats dates as `YYYY-MM-DD`. */
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "numeric", hourCycle: "h23" });

export const londonDate = (at: Date): string => dateFormat.format(at);

export const londonDay = (at: Date | string): Day => dayOfDate(londonDate(new Date(at)));

export const londonHour = (at: Date): number => Number(hourFormat.format(at));
