const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const count = new Intl.NumberFormat("en-GB");

export const formatDate = (iso: string): string => date.format(new Date(iso));

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

export const formatCount = (value: number): string => count.format(value);

/** One decimal below 10%, where progress is slow enough that the decimal is the part that moves. */
export const formatPercent = (part: number, whole: number): string => {
  const percent = whole === 0 ? 0 : (part / whole) * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.floor(percent)}%`;
};

export const formatDistance = (metres: number | null): string =>
  metres === null ? "" : metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
