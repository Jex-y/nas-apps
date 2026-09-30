import type { ComponentType } from "react";
import type { MapBounds, MapData } from "../../../../contract";
import type { MapColours } from "../hooks/useThemeColours";

/** What every overlay is given: the map's data, the theme's colours, and what is in view and chosen. */
export type OverlayProps = {
  readonly data: MapData;
  readonly colours: MapColours;
  readonly visible: boolean;
  readonly view: MapBounds | null;
  readonly selected: string | null;
  readonly onSelect: (propertyId: string | null) => void;
  readonly showRejected: boolean;
};

/**
 * A layer of the map someone can switch on and off: `Layer` draws it through `useOverlay`, and `Legend` explains it
 * in the layer panel. Adding one to `OVERLAYS` in overlays.ts is all it takes to offer it.
 */
export type Overlay = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly on: boolean;
  readonly Layer: ComponentType<OverlayProps>;
  readonly Legend?: ComponentType<OverlayProps>;
};
