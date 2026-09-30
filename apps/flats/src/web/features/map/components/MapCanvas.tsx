import type { FeatureCollection } from "geojson";
import {
  type GeoJSONSource,
  type LayerSpecification,
  MapLibreMap,
  NavigationControl,
  type PaddingOptions,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { MAP_WORKER_PATH, type MapBounds } from "../../../../contract";

setWorkerUrl(MAP_WORKER_PATH);

/** OpenFreeMap's vector styles: free, keyless, attributed in the corner as its terms ask. */
const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

/** The map, and a counter that moves each time its style (and so every layer on it) is replaced. */
type MapHandle = { readonly map: MapLibreMap; readonly version: number };

/** Where the map first looks, kept `padding` pixels clear of each edge, e.g. of a panel over it. */
export type MapStart = { readonly bounds: MapBounds; readonly padding: PaddingOptions };

const MapContext = createContext<MapHandle | null>(null);

const boundsOf = (map: MapLibreMap): MapBounds => {
  const bounds = map.getBounds();
  return { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() };
};

/**
 * A MapLibre map over OpenFreeMap tiles, light or dark to suit the theme, fitted first to `start`. Overlays render
 * as its children and reach it through `useOverlay`.
 */
export const MapCanvas = ({
  scheme,
  start,
  onMove,
  children,
}: {
  scheme: keyof typeof STYLES;
  start: MapStart | null;
  onMove: (bounds: MapBounds) => void;
  children: ReactNode;
}) => {
  const host = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<MapHandle | null>(null);
  const latestOnMove = useRef(onMove);
  latestOnMove.current = onMove;
  const shown = useRef(scheme);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the map is made once; later changes go through its API
  useEffect(() => {
    const container = host.current;
    if (container === null) {
      return;
    }
    const map = new MapLibreMap({
      container,
      style: STYLES[scheme],
      ...(start !== null && {
        bounds: [start.bounds.west, start.bounds.south, start.bounds.east, start.bounds.north],
        fitBoundsOptions: { padding: start.padding, maxZoom: 14 },
      }),
      center: [-0.1, 51.51],
      zoom: 11,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    let version = 0;
    map.on("style.load", () => {
      version += 1;
      setHandle({ map, version });
    });
    map.on("moveend", () => latestOnMove.current(boundsOf(map)));
    map.once("load", () => latestOnMove.current(boundsOf(map)));
    return () => {
      setHandle(null);
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (handle !== null && shown.current !== scheme) {
      shown.current = scheme;
      handle.map.setStyle(STYLES[scheme]);
    }
  }, [handle, scheme]);

  return (
    <div ref={host} className="map-canvas" data-scheme={scheme}>
      {handle !== null && <MapContext.Provider value={handle}>{children}</MapContext.Provider>}
    </div>
  );
};

/** The map, for an overlay drawn in HTML rather than as map layers, e.g. markers. */
export const useMap = () => useContext(MapContext)?.map ?? null;

/** The base map's first label layer, so an overlay can sit beneath the place names and stay out of their way. */
const firstLabel = (map: MapLibreMap) => map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;

/**
 * Keeps one overlay on the map: its GeoJSON under `id` and its `layers`, re-added whenever the base style changes,
 * with the data and visibility kept current. `onTop` layers go above the place names, e.g. markers to click.
 */
export const useOverlay = ({
  id,
  data,
  layers,
  visible,
  onTop = false,
}: {
  id: string;
  data: FeatureCollection;
  layers: readonly LayerSpecification[];
  visible: boolean;
  onTop?: boolean;
}) => {
  const handle = useContext(MapContext);
  const latestData = useRef(data);
  latestData.current = data;

  useEffect(() => {
    if (handle === null) {
      return;
    }
    const { map } = handle;
    map.addSource(id, { type: "geojson", data: latestData.current });
    const before = onTop ? undefined : firstLabel(map);
    for (const layer of layers) {
      map.addLayer(layer, before);
    }
    return () => {
      // After a style swap the old layers are already gone, and after unmount so is the map.
      if (map.getStyle() === undefined) {
        return;
      }
      for (const layer of layers) {
        if (map.getLayer(layer.id) !== undefined) {
          map.removeLayer(layer.id);
        }
      }
      if (map.getSource(id) !== undefined) {
        map.removeSource(id);
      }
    };
  }, [handle, id, layers, onTop]);

  useEffect(() => {
    handle?.map.getSource<GeoJSONSource>(id)?.setData(data);
  }, [handle, id, data]);

  useEffect(() => {
    if (handle === null) {
      return;
    }
    for (const layer of layers) {
      if (handle.map.getLayer(layer.id) !== undefined) {
        handle.map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
      }
    }
  }, [handle, layers, visible]);

  return handle?.map ?? null;
};
