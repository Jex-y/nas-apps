/** police.uk's categories, as a person would name them. */
const CATEGORY_NAMES: Readonly<Record<string, string>> = {
  "anti-social-behaviour": "Anti-social behaviour",
  "bicycle-theft": "Bicycle theft",
  burglary: "Burglary",
  "criminal-damage-arson": "Criminal damage and arson",
  drugs: "Drugs",
  "other-theft": "Other theft",
  "possession-of-weapons": "Weapons",
  "public-order": "Public order",
  robbery: "Robbery",
  shoplifting: "Shoplifting",
  "theft-from-the-person": "Theft from the person",
  "vehicle-crime": "Vehicle crime",
  "violent-crime": "Violence and sexual offences",
  "other-crime": "Other crime",
};

export const categoryName = (category: string): string =>
  CATEGORY_NAMES[category] ?? category.replace(/-/g, " ").replace(/^./, (first) => first.toUpperCase());

const month = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** `("2026-07", 12)` → `Aug 2025 to Jul 2026`. */
export const crimePeriod = (throughMonth: string, months: number): string => {
  const [year, last] = throughMonth.split("-").map(Number) as [number, number];
  const from = new Date(Date.UTC(year, last - months, 1));
  const to = new Date(Date.UTC(year, last - 1, 1));
  return `${month.format(from)} to ${month.format(to)}`;
};
