import { Marker } from "maplibre-gl";
import { useEffect, useState } from "react";
import { useThemeColours } from "../hooks/useThemeColours";
import { MapCanvas, type MapStart, useMap } from "./MapCanvas";

type Place = { readonly latitude: number; readonly longitude: number };

/** Close enough to read the street names, far enough out to see the stations around. */
export const LOCATION_ZOOM = 14;

const Pin = ({ latitude, longitude, zoom }: Place & { zoom: number }) => {
  const map = useMap();

  useEffect(() => {
    if (map === null) {
      return;
    }
    const element = document.createElement("div");
    element.className = "map-pin";
    const marker = new Marker({ element, anchor: "bottom" }).setLngLat([longitude, latitude]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, latitude, longitude]);

  useEffect(() => {
    map?.jumpTo({ center: [longitude, latitude], zoom });
  }, [map, latitude, longitude, zoom]);

  return null;
};

/** One place on the map, pinned and centred at `zoom`. One that is not `interactive` is a picture of it. */
export const LocationMap = ({
  latitude,
  longitude,
  zoom = LOCATION_ZOOM,
  interactive = true,
}: Place & { zoom?: number; interactive?: boolean }) => {
  const colours = useThemeColours();
  const [start] = useState((): MapStart => ({ kind: "centre", latitude, longitude, zoom }));
  return (
    <div className="location-map">
      <MapCanvas scheme={colours.scheme} start={start} interactive={interactive}>
        <Pin latitude={latitude} longitude={longitude} zoom={zoom} />
      </MapCanvas>
    </div>
  );
};
