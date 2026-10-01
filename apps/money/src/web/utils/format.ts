import type { Kind } from "../../contract";

export const KIND_LABELS: Readonly<Record<Kind, string>> = {
  cash: "Cash",
  investment: "Investments",
  property: "Property",
  pension: "Pensions",
  debt: "Debts",
  other: "Other",
};

const pounds = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const wholePounds = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const compactPounds = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  notation: "compact",
  maximumFractionDigits: 1,
});
const signedPounds = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", signDisplay: "exceptZero" });

/** "£1,234.56" */
export const formatPence = (pence: number): string => pounds.format(pence / 100);

/** "£1,235", for headline figures where pennies are noise. */
export const formatPounds = (pence: number): string => wholePounds.format(pence / 100);

/** "£12.9K", for axis ticks. */
export const formatCompact = (pence: number): string => compactPounds.format(pence / 100);

/** "+£1,234.56", for changes. */
export const formatSigned = (pence: number): string => signedPounds.format(pence / 100);

const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const weekdayDayMonth = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonth = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const dayMonthTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** "21 Sep 2026" for an ISO date or instant. */
export const formatDate = (date: string): string => dayMonthYear.format(new Date(date));

/** "Mon 21 September 2026" for an ISO date. */
export const formatDay = (date: string): string => weekdayDayMonth.format(new Date(date));

/** "September 2026" for `2026-09` or any date in it. */
export const formatMonth = (month: string): string => monthYear.format(new Date(`${month.slice(0, 7)}-01`));

/** "Sep", or "Jan 2026" where a year begins, for an axis. */
export const formatAxisMonth = (month: string): string =>
  month.slice(5, 7) === "01"
    ? `${shortMonth.format(new Date(month))} ${month.slice(0, 4)}`
    : shortMonth.format(new Date(month));

/** "21 Sep, 12:00" in the viewer's own time. */
export const formatInstant = (instant: string): string => dayMonthTime.format(new Date(instant));

export const today = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
