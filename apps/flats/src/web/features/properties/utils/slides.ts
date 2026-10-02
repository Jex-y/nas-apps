import type { Photo, PropertyDetail, PropertySummary } from "../../../../contract";
import type { Binding } from "../../../utils/keymap";

/** One thing to look at for a property. */
export type Slide =
  | { readonly kind: Photo["kind"]; readonly url: string }
  | { readonly kind: "map"; readonly latitude: number; readonly longitude: number };

/** The thumbnail alone, to show until the rest has loaded. */
export const coverSlides = ({ thumbnailUrl }: Pick<PropertySummary, "thumbnailUrl">): Slide[] =>
  thumbnailUrl === null ? [] : [{ kind: "photo", url: thumbnailUrl }];

/** A property's photos, then its floorplans, then where it is. */
export const slidesOf = (property: PropertyDetail): Slide[] => [
  ...(property.photos.length === 0
    ? coverSlides(property)
    : (["photo", "floorplan"] as const).flatMap((kind) => property.photos.filter((photo) => photo.kind === kind))),
  ...(property.latitude === null || property.longitude === null
    ? []
    : [{ kind: "map" as const, latitude: property.latitude, longitude: property.longitude }]),
];

/** Where the first slide of `kind` is, or `null` when there is none. */
export const firstOf = (slides: readonly Slide[], kind: Slide["kind"]): number | null => {
  const index = slides.findIndex((slide) => slide.kind === kind);
  return index === -1 ? null : index;
};

/** The slide `delta` on from the one at `index`, stopping at either end. */
export const stepFrom = (slides: readonly Slide[], index: number, delta: number): number =>
  Math.max(0, Math.min(slides.length - 1, index + delta));

/** Stepping through `slides` from the one at `index`, and jumping to the floorplan or the map. */
export const slideBindings = (
  slides: readonly Slide[],
  index: number,
  onStep: (index: number) => void,
): readonly Binding[] => {
  const jump = (kind: Slide["kind"]) => () => onStep(firstOf(slides, kind) ?? index);
  return [
    { keys: ["l"], does: "Next photo", run: () => onStep(stepFrom(slides, index, 1)) },
    { keys: ["h"], does: "Previous photo", run: () => onStep(stepFrom(slides, index, -1)) },
    { keys: ["0"], does: "First photo", run: () => onStep(0) },
    { keys: ["$"], does: "Last photo", run: () => onStep(stepFrom(slides, slides.length, 0)) },
    { keys: ["f"], does: "Floorplan", run: jump("floorplan") },
    { keys: ["m"], does: "Where it is on the map", run: jump("map") },
  ];
};
