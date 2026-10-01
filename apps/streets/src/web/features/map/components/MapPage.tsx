import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import type { MapStreet, StreetState } from "../../../../contract";
import { loadView, saveView } from "../../../lib/view";
import { type Viewport, useMapStreets, useStreetNodes } from "../api/map";

/** Streets are only drawn from this zoom in, so a request never covers more than a few kilometres. */
const STREETS_FROM_ZOOM = 14;

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const cssColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Run streets strongly, started ones lighter, the rest faint enough to read the map through. */
const styleOf = (state: StreetState): L.PolylineOptions => {
  switch (state) {
    case "complete":
      return { color: cssColor("--accent"), weight: 5, opacity: 0.95 };
    case "partial":
      return { color: cssColor("--accent"), weight: 4, opacity: 0.45, dashArray: "6 5" };
    case "untouched":
      return { color: cssColor("--pink"), weight: 3, opacity: 0.35 };
  }
};

/** Built as elements rather than HTML, since street names come from OpenStreetMap. */
const popupFor = (street: MapStreet): HTMLElement => {
  const popup = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = street.name;
  popup.append(name, document.createElement("br"), `${street.hitCount} of ${street.nodeCount} nodes run`);
  return popup;
};

const viewportOf = (map: L.Map): Viewport | null => {
  if (map.getZoom() < STREETS_FROM_ZOOM) {
    return null;
  }
  const bounds = map.getBounds();
  return { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() };
};

/** `?at=lat,lon` opens the map on a point, e.g. from a suggestion. */
const parseAt = (search: string): L.LatLngTuple | null => {
  const [lat, lon] = (new URLSearchParams(search).get("at") ?? "").split(",").map(Number);
  return lat === undefined || lon === undefined || Number.isNaN(lat) || Number.isNaN(lon) ? null : [lat, lon];
};

export const MapPage = () => {
  const search = useSearch();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const streetLayer = useRef<L.LayerGroup | null>(null);
  const nodeLayer = useRef<L.LayerGroup | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const streets = useMapStreets(viewport);
  const nodes = useStreetNodes(selected);

  useEffect(() => {
    if (container.current === null) {
      return;
    }
    const saved = loadView();
    const created = L.map(container.current, { preferCanvas: true, zoomControl: false }).setView(
      parseAt(search) ?? [saved.lat, saved.lon],
      parseAt(search) === null ? saved.zoom : 16,
    );
    L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(created);
    streetLayer.current = L.layerGroup().addTo(created);
    nodeLayer.current = L.layerGroup().addTo(created);
    const moved = () => {
      const centre = created.getCenter();
      saveView({ lat: centre.lat, lon: centre.lng, zoom: created.getZoom() });
      setViewport(viewportOf(created));
    };
    created.on("moveend", moved);
    created.on("click", () => setSelected(null));
    map.current = created;
    moved();
    return () => {
      created.remove();
      map.current = null;
    };
  }, [search]);

  useEffect(() => {
    const layer = streetLayer.current;
    if (layer === null) {
      return;
    }
    layer.clearLayers();
    for (const street of streets.data?.streets ?? []) {
      L.polyline(
        street.paths.map((path) => path.map(([lat, lon]) => [lat, lon] as L.LatLngTuple)),
        styleOf(street.state),
      )
        .bindPopup(popupFor(street))
        .on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          setSelected(street.id);
        })
        .addTo(layer);
    }
  }, [streets.data]);

  useEffect(() => {
    const layer = nodeLayer.current;
    if (layer === null) {
      return;
    }
    layer.clearLayers();
    for (const node of selected === null ? [] : (nodes.data ?? [])) {
      L.circleMarker([node.lat, node.lon], {
        radius: 4,
        weight: 1,
        color: cssColor("--fg"),
        fillColor: cssColor(node.hit ? "--accent" : "--error"),
        fillOpacity: 1,
      }).addTo(layer);
    }
  }, [selected, nodes.data]);

  const locate = () => map.current?.locate({ setView: true, maxZoom: 16 });

  return (
    <section className="map-page">
      <div ref={container} className="map" />
      <div className="map-overlay">
        {viewport === null && <span className="map-hint">Zoom in to see streets</span>}
        {streets.error && <span className="map-hint error">{streets.error.message}</span>}
        <button type="button" onClick={locate}>
          Locate
        </button>
      </div>
      <ul className="map-legend" aria-label="Legend">
        <li>
          <span className="swatch complete" /> Run
        </li>
        <li>
          <span className="swatch partial" /> Started
        </li>
        <li>
          <span className="swatch untouched" /> Not yet
        </li>
      </ul>
    </section>
  );
};
