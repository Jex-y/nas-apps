const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const clock = new Intl.DateTimeFormat("en-GB", { timeStyle: "medium" });
const hourOfDay = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});
const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
const number = new Intl.NumberFormat("en-GB");

export const formatCount = (value: number): string => number.format(value);

export const formatClock = (iso: string): string => clock.format(new Date(iso));

export const formatHour = (iso: string): string => hourOfDay.format(new Date(iso));

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

const oneDecimal = (value: number): string => (Math.round(value * 10) / 10).toString();

export const formatDuration = (ms: number): string => {
  const abs = Math.abs(ms);
  if (abs < MINUTE) {
    return `${Math.round(abs / SECOND)} s`;
  }
  if (abs < HOUR) {
    return `${Math.round(abs / MINUTE)} min`;
  }
  return abs < DAY ? `${oneDecimal(abs / HOUR)} h` : `${oneDecimal(abs / DAY)} d`;
};

const UNITS = [
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
] as const;

/** Relative to when the report was generated, so every age on the page agrees with the data it came with. */
export const formatRelative = (iso: string, reference: string): string => {
  const diff = Date.parse(iso) - Date.parse(reference);
  const unit = UNITS.find(([, size]) => Math.abs(diff) >= size);
  return unit === undefined
    ? relative.format(Math.round(diff / SECOND), "second")
    : relative.format(Math.round(diff / unit[1]), unit[0]);
};

export const ageOf = (iso: string, reference: string): number => Date.parse(reference) - Date.parse(iso);

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export const formatBytes = (bytes: number): string => {
  const exponent = Math.min(BYTE_UNITS.length - 1, bytes < 1 ? 0 : Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[exponent]}`;
};

export const shortCommit = (sha: string): string => sha.slice(0, 7);

export const firstLine = (text: string): string => text.split("\n", 1)[0] ?? text;
