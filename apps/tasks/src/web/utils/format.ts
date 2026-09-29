import type { Status } from "../../contract";
import { type Day, dateOfDay, dayOfDate } from "../../plan";

export const STATUS_LABELS: Readonly<Record<Status, string>> = { todo: "To do", doing: "Doing", done: "Done" };

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "21 Sep" for a schedule day. */
export const formatDay = (day: Day): string => dayMonth.format(new Date(dateOfDay(day)));

/** "21 Sep" for an ISO date. */
export const formatDate = (date: string): string => formatDay(dayOfDate(date));

export const days = (count: number): string => `${count} ${Math.abs(count) === 1 ? "day" : "days"}`;
