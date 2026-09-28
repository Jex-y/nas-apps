import type { Commute, PropertySummary } from "../../contract";

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export const formatPrice = (price: number | null, qualifier = ""): string =>
  price === null ? "POA" : [qualifier, money.format(price)].filter(Boolean).join(" ");

export const formatMoney = (amount: number | null): string | null => (amount === null ? null : money.format(amount));

export const formatDate = (iso: string): string => date.format(new Date(iso));

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

export const pricePerSqft = (property: Pick<PropertySummary, "price" | "sizeSqft">): string | null =>
  property.price === null || property.sizeSqft === null || property.sizeSqft === 0
    ? null
    : `${money.format(property.price / property.sizeSqft)}/sq ft`;

const TENURES: Readonly<Record<PropertySummary["tenure"], string>> = {
  freehold: "Freehold",
  leasehold: "Leasehold",
  share_of_freehold: "Share of freehold",
  commonhold: "Commonhold",
  unknown: "Tenure unknown",
};

export const formatCommuteTime = (minutes: Commute["minutes"]): string =>
  minutes === null ? "no route" : `${minutes} min`;

/** e.g. "Office 43 min · Gym no route". */
export const formatCommutes = (commutes: readonly Commute[]): string =>
  commutes.map((commute) => `${commute.name} ${formatCommuteTime(commute.minutes)}`).join(" · ");

export const formatTenure = (property: Pick<PropertySummary, "tenure" | "leaseYearsRemaining">): string =>
  property.leaseYearsRemaining === null
    ? TENURES[property.tenure]
    : `${TENURES[property.tenure]}, ${property.leaseYearsRemaining} yrs`;

/** The facts that decide whether a flat is worth a look, as short labels, skipping what the portal did not say. */
export const keyFacts = (property: PropertySummary): string[] =>
  [
    property.bedrooms === null ? null : `${property.bedrooms} bed`,
    property.bathrooms === null ? null : `${property.bathrooms} bath`,
    property.sizeSqft === null ? null : `${property.sizeSqft.toLocaleString("en-GB")} sq ft`,
    pricePerSqft(property),
    formatTenure(property),
    property.annualServiceCharge === null ? null : `${formatMoney(property.annualServiceCharge)}/yr service`,
    property.councilTaxBand === null ? null : `Band ${property.councilTaxBand}`,
  ].filter((fact): fact is string => fact !== null);

export const STATUS_LABELS = {
  new: "New",
  shortlisted: "Shortlisted",
  viewing_booked: "Viewing booked",
  viewed: "Viewed",
  offer_made: "Offer made",
  rejected: "Rejected",
} as const satisfies Record<PropertySummary["status"], string>;

export const AVAILABILITY_LABELS = {
  available: null,
  under_offer: "Under offer",
  sold_stc: "Sold STC",
  removed: "Taken down",
} as const satisfies Record<PropertySummary["availability"], string | null>;
