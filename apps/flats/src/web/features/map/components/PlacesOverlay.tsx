import { Marker } from "maplibre-gl";
import { useEffect } from "react";
import { useMap } from "./MapCanvas";
import type { OverlayProps } from "./overlay";

/** Each commute place as a labelled pin, drawn as HTML so it takes the theme's type and needs no map fonts. */
export const PlacesOverlay = ({ data, visible }: OverlayProps) => {
  const map = useMap();

  useEffect(() => {
    if (map === null || !visible) {
      return;
    }
    const markers = data.places.map((place) => {
      const element = document.createElement("div");
      element.className = "map-place";
      element.textContent = place.name;
      return new Marker({ element, anchor: "bottom" }).setLngLat([place.longitude, place.latitude]).addTo(map);
    });
    return () => {
      for (const marker of markers) {
        marker.remove();
      }
    };
  }, [map, data.places, visible]);

  return null;
};
