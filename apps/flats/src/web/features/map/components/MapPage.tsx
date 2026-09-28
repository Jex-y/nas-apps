import type { LatLngTuple, PointTuple } from "leaflet";
import { useState, useSyncExternalStore } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";
import { Link } from "wouter";
import {
  type MapLayer,
  type MapStroke,
  PROPERTY_STATUSES,
  type PropertyStatus,
  type PropertySummary,
  STROKE_WIDTHS,
} from "../../../../contract";
import { formatPrice, keyFacts, STATUS_LABELS } from "../../../utils/format";
import { useDestinations } from "../../destinations/api/destinations";
import { useProperties } from "../../properties/api/properties";
import { useAddStroke, useEraseStroke, useMapLayers, useUpdateLayer } from "../api/map";
import { DrawingSurface, STROKE_OPACITY, type Tool } from "./DrawingSurface";
import { LayerPanel } from "./LayerPanel";

const LONDON: LatLngTuple = [51.5074, -0.1278];

/** Esri's grey canvas: quiet enough for pins and ink to stand out, keyless, with a dark twin; labels are a layer above. */
const canvasTiles = (shade: "Light" | "Dark", part: "Base" | "Reference") =>
  `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${shade}_Gray_${part}/MapServer/tile/{z}/{y}/{x}`;

const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");
const usePrefersDark = () =>
  useSyncExternalStore(
    (onChange) => {
      darkScheme.addEventListener("change", onChange);
      return () => darkScheme.removeEventListener("change", onChange);
    },
    () => darkScheme.matches,
  );

/** One undoable step: undoing a drawn stroke erases it, undoing an erased one puts it back. */
type Edit = { readonly kind: "draw" | "erase"; readonly layerId: string; readonly stroke: MapStroke };

const located = (property: PropertySummary): property is PropertySummary & { latitude: number; longitude: number } =>
  property.latitude !== null && property.longitude !== null;

const PropertyPin = ({ property }: { property: PropertySummary & { latitude: number; longitude: number } }) => (
  <CircleMarker
    center={[property.latitude, property.longitude]}
    radius={7}
    pathOptions={{ className: `pin status-${property.status}` }}
  >
    <Popup>
      <Link href={`/properties/${property.id}`} className="pin-popup">
        <strong>{formatPrice(property.price, property.priceQualifier)}</strong>
        <span>{property.address}</span>
        <span className="muted">{[STATUS_LABELS[property.status], ...keyFacts(property)].join(" · ")}</span>
      </Link>
    </Popup>
  </CircleMarker>
);

const Strokes = ({ layer }: { layer: MapLayer }) =>
  layer.strokes.map((stroke) => (
    <Polyline
      key={stroke.id}
      positions={stroke.points}
      interactive={false}
      pathOptions={{ color: layer.colour, weight: stroke.width, opacity: STROKE_OPACITY }}
    />
  ));

export const MapPage = () => {
  const properties = useProperties("all");
  const destinations = useDestinations();
  const layers = useMapLayers();
  const addStroke = useAddStroke();
  const eraseStroke = useEraseStroke();
  const updateLayer = useUpdateLayer();
  const dark = usePrefersDark();

  const [shown, setShown] = useState<ReadonlySet<PropertyStatus>>(
    () => new Set(PROPERTY_STATUSES.filter((status) => status !== "rejected")),
  );
  const [tool, setTool] = useState<Tool>("pen");
  const [touchDraws, setTouchDraws] = useState(() => !window.matchMedia("(any-pointer: coarse)").matches);
  const [width, setWidth] = useState<number>(STROKE_WIDTHS[1]);
  const [chosenLayerId, setChosenLayerId] = useState<string | null>(null);
  const [edits, setEdits] = useState<readonly Edit[]>([]);

  if (properties.isError || layers.isError || destinations.isError) {
    return <p className="error">{(properties.error ?? layers.error ?? destinations.error)?.message}</p>;
  }
  // The map frames what is on it once, when it mounts, so it waits for everything it shows.
  if (properties.isPending || layers.isPending || destinations.isPending) {
    return <p className="muted">Loading…</p>;
  }

  const target = layers.data.find((layer) => layer.id === chosenLayerId) ?? layers.data[0] ?? null;
  const pins = properties.data.filter(located).filter((property) => shown.has(property.status));
  const places = destinations.data;
  const everything = [
    ...pins.map((pin): LatLngTuple => [pin.latitude, pin.longitude]),
    ...places.map((place): LatLngTuple => [place.latitude, place.longitude]),
  ];
  const framing =
    everything.length > 1
      ? { bounds: everything, boundsOptions: { padding: [32, 32] as PointTuple } }
      : { center: everything[0] ?? LONDON, zoom: 13 };

  const draw = (layerId: string, stroke: MapStroke) => {
    addStroke.mutate({ layerId, stroke });
    if (layers.data.some((layer) => layer.id === layerId && !layer.visible)) {
      updateLayer.mutate({ id: layerId, update: { visible: true } });
    }
    setEdits((previous) => [...previous, { kind: "draw", layerId, stroke }]);
  };

  const erase = (layerId: string, stroke: MapStroke) => {
    eraseStroke.mutate(stroke.id);
    setEdits((previous) => [...previous, { kind: "erase", layerId, stroke }]);
  };

  const undo = () => {
    const last = edits.at(-1);
    if (last === undefined) {
      return;
    }
    setEdits(edits.slice(0, -1));
    if (last.kind === "draw") {
      eraseStroke.mutate(last.stroke.id);
    } else if (layers.data.some((layer) => layer.id === last.layerId)) {
      addStroke.mutate({ layerId: last.layerId, stroke: last.stroke });
    }
  };

  return (
    <section className="map-page">
      <MapContainer className="map" {...framing}>
        {(["Base", "Reference"] as const).map((part) => (
          <TileLayer
            key={part}
            url={canvasTiles(dark ? "Dark" : "Light", part)}
            attribution="Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
            maxNativeZoom={16}
            maxZoom={19}
          />
        ))}
        {layers.data
          .filter((layer) => layer.visible)
          .map((layer) => (
            <Strokes key={layer.id} layer={layer} />
          ))}
        {places.map((place) => (
          <CircleMarker
            key={place.id}
            center={[place.latitude, place.longitude]}
            radius={6}
            pathOptions={{ className: "pin destination" }}
          >
            <Tooltip permanent direction="top" offset={[0, -6]}>
              {place.name}
            </Tooltip>
          </CircleMarker>
        ))}
        {pins.map((property) => (
          <PropertyPin key={property.id} property={property} />
        ))}
        <DrawingSurface
          tool={tool}
          touchDraws={touchDraws}
          target={target}
          width={width}
          layers={layers.data}
          onDraw={draw}
          onErase={erase}
        />
      </MapContainer>
      <LayerPanel
        layers={layers.data}
        target={target}
        onTarget={setChosenLayerId}
        tool={tool}
        onTool={setTool}
        width={width}
        onWidth={setWidth}
        touchDraws={touchDraws}
        onTouchDraws={setTouchDraws}
        canUndo={edits.length > 0}
        onUndo={undo}
        shown={shown}
        onShown={setShown}
      />
    </section>
  );
};
