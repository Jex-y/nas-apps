import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import type { MapStreet, MapView, StreetState } from "../../../../contract";
import { loadView, saveView } from "../../../lib/view";
import { tilesIn, useMapTiles, useStreetNodes } from "../api/map";

/** Streets are only drawn from this zoom in, so a request never covers more than a few kilometres. */
const STREETS_FROM_ZOOM = 14;

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const cssColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Run streets strongest, started ones dashed, the rest thin enough to read the map through. */
const styleOf = (state: StreetState): L.PolylineOptions => {
  switch (state) {
    case "complete":
      return { color: cssColor("--street-complete"), weight: 5, opacity: 1 };
    case "partial":
      return { color: cssColor("--street-partial"), weight: 4, opacity: 0.9, dashArray: "6 5" };
    case "untouched":
      return { color: cssColor("--street-untouched"), weight: 3, opacity: 0.6 };
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

/** The map tiles in view, or `null` when zoomed out too far to draw streets. */
const tilesOf = (map: L.Map): number[] | null => {
  if (map.getZoom() < STREETS_FROM_ZOOM) {
    return null;
  }
  const bounds = map.getBounds();
  return tilesIn({
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  });
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
  /** Each tile's layer, with the response it was drawn from, so only tiles that change are redrawn. */
  const drawn = useRef(new Map<number, { readonly view: MapView; readonly layer: L.LayerGroup }>());
  const [tiles, setTiles] = useState<number[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const results = useMapTiles(tiles ?? []);
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
      setTiles(tilesOf(created));
    };
    created.on("moveend", moved);
    created.on("click", () => setSelected(null));
    map.current = created;
    moved();
    return () => {
      created.remove();
      map.current = null;
      drawn.current.clear();
    };
  }, [search]);

  useEffect(() => {
    const layer = streetLayer.current;
    if (layer === null) {
      return;
    }
    const views = new Map((tiles ?? []).map((tile, index) => [tile, results[index]?.data]));
    for (const [tile, { view, layer: tileLayer }] of drawn.current) {
      if (views.get(tile) !== view) {
        layer.removeLayer(tileLayer);
        drawn.current.delete(tile);
      }
    }
    for (const [tile, view] of views) {
      if (view !== undefined && !drawn.current.has(tile)) {
        const tileLayer = L.layerGroup(
          view.streets.map((street) =>
            L.polyline(
              street.paths.map((path) => path.map(([lat, lon]) => [lat, lon] as L.LatLngTuple)),
              styleOf(street.state),
            )
              .bindPopup(popupFor(street))
              .on("click", (event) => {
                L.DomEvent.stopPropagation(event);
                setSelected(street.id);
              }),
          ),
        );
        drawn.current.set(tile, { view, layer: tileLayer.addTo(layer) });
      }
    }
  }, [tiles, results]);

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

  const error = results.find((result) => result.error)?.error;
  const loading = results.some((result) => result.isPending);
  const locate = () => map.current?.locate({ setView: true, maxZoom: 16 });

  return (
    <section className="map-page">
      <div ref={container} className="map" />
      <div className="map-overlay">
        {tiles === null && <span className="map-hint">Zoom in to see streets</span>}
        {error ? (
          <span className="map-hint error">{error.message}</span>
        ) : (
          loading && <span className="map-hint">Loading streets…</span>
        )}
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
