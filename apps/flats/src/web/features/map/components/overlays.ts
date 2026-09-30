import { CrimeLegend, CrimeOverlay } from "./CrimeOverlay";
import { ListingsLegend, ListingsOverlay } from "./ListingsOverlay";
import type { Overlay } from "./overlay";
import { PlacesOverlay } from "./PlacesOverlay";
import { PriceLegend, PriceOverlay } from "./PriceOverlay";

/** The layers on offer, drawn in this order, bottom first. */
export const OVERLAYS: readonly Overlay[] = [
  {
    id: "crime",
    label: "Crime",
    description: "Street crime over the last year",
    on: false,
    Layer: CrimeOverlay,
    Legend: CrimeLegend,
  },
  {
    id: "price",
    label: "Price per sq ft",
    description: "Cheap to dear for your search",
    on: false,
    Layer: PriceOverlay,
    Legend: PriceLegend,
  },
  { id: "places", label: "Commute places", description: "Where commutes are timed to", on: true, Layer: PlacesOverlay },
  {
    id: "listings",
    label: "Listings",
    description: "Coloured by score",
    on: true,
    Layer: ListingsOverlay,
    Legend: ListingsLegend,
  },
];
