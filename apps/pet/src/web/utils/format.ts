import { type Species, STALE_HEALTH_HOURS, type Trait } from "../../contract";

const count = new Intl.NumberFormat("en-GB");
const time = new Intl.DateTimeFormat("en-GB", { timeStyle: "short" });
const dayAndTime = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const shortDay = new Intl.DateTimeFormat("en-GB", { weekday: "narrow", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export const formatCount = (value: number): string => count.format(value);

/** `YYYY-MM-DD` dates are calendar days, so they are formatted in UTC to stop the viewer's zone moving them. */
export const formatWeekday = (date: string): string => shortDay.format(new Date(date));
export const formatDay = (date: string): string => longDay.format(new Date(date));

const HOUR_MS = 60 * 60_000;

/** "14:02" today, "Sun 14:02" before. */
export const formatSynced = (iso: string, now = new Date()): string => {
  const at = new Date(iso);
  return at.toDateString() === now.toDateString() ? time.format(at) : dayAndTime.format(at);
};

export const isStale = (iso: string, now = new Date()): boolean =>
  now.getTime() - Date.parse(iso) > STALE_HEALTH_HOURS * HOUR_MS;

export const SPECIES_NAMES: Readonly<Record<Species, string>> = {
  chick: "Chick",
  frog: "Frog",
  cat: "Cat",
  bunny: "Bunny",
  axolotl: "Axolotl",
  dragon: "Dragon",
};

export const TRAIT_NOTES: Readonly<Record<Trait, string>> = {
  cheerful: "Starts every day in a better mood.",
  greedy: "Treats cheer it up twice as much.",
  cuddly: "A pat counts double.",
  playful: "Plays twice as long before it tires.",
  sleepy: "In bed by nine, up at eight.",
};

export const capitalised = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
