import type { PropertySummary } from "../../../../contract";

/** Opens the property's first listing on its portal, in a new tab. */
export const openOnPortal = ({ listings }: Pick<PropertySummary, "listings">) => {
  const [listing] = listings;
  if (listing !== undefined) {
    window.open(listing.url, "_blank", "noreferrer");
  }
};
