import type { LayerSpecification, MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { formatPoints } from "../../../utils/format";
import { listingFeatures, spread } from "../utils/features";
import { useOverlay } from "./MapCanvas";
import type { OverlayProps } from "./overlay";

const ID = "listings";

/** Each listing as a dot, coloured from red to green by its score among the flats in play. */
export const ListingsOverlay = ({ data, colours, visible, selected, onSelect, showRejected }: OverlayProps) => {
  const features = useMemo(() => listingFeatures(data, showRejected), [data, showRejected]);
  const scores = spread(
    data.properties.flatMap((property) => (property.ranking.kind === "scored" ? [property.ranking.total] : [])),
  );
  const low = scores?.low ?? 0;
  const high = scores?.high ?? 1;
  const layers = useMemo(
    (): LayerSpecification[] => [
      {
        id: `${ID}-out`,
        type: "circle",
        source: ID,
        filter: ["==", ["get", "standing"], "out"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
          "circle-color": colours.muted,
          "circle-opacity": 0.6,
          "circle-stroke-color": colours.surface,
          "circle-stroke-width": 1,
        },
      },
      {
        id: `${ID}-in`,
        type: "circle",
        source: ID,
        filter: ["==", ["get", "standing"], "in"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 13, 7, 16, 11],
          "circle-color": [
            "interpolate-hcl",
            ["linear"],
            ["get", "score"],
            low,
            colours.error,
            (low + high) / 2,
            colours.between,
            high,
            colours.success,
          ],
          "circle-stroke-color": colours.surface,
          "circle-stroke-width": 2,
        },
      },
      {
        id: `${ID}-selected`,
        type: "circle",
        source: ID,
        filter: ["==", ["get", "id"], selected ?? ""],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 9, 13, 11, 16, 15],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": colours.fg,
          "circle-stroke-width": 2.5,
        },
      },
    ],
    [colours, low, high, selected],
  );
  const map = useOverlay({ id: ID, data: features, layers, visible, onTop: true });

  useEffect(() => {
    if (map === null) {
      return;
    }
    const layerIds = [`${ID}-in`, `${ID}-out`];
    const choose = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") {
        onSelect(id);
      }
    };
    const pointer = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const plain = () => {
      map.getCanvas().style.cursor = "";
    };
    // A click on the map itself, away from any listing, puts the card away.
    const clear = (event: MapMouseEvent) => {
      const drawn = layerIds.filter((layer) => map.getLayer(layer) !== undefined);
      if (map.queryRenderedFeatures(event.point, { layers: drawn }).length === 0) {
        onSelect(null);
      }
    };
    map.on("click", clear);
    for (const layer of layerIds) {
      map.on("click", layer, choose);
      map.on("mouseenter", layer, pointer);
      map.on("mouseleave", layer, plain);
    }
    return () => {
      map.off("click", clear);
      for (const layer of layerIds) {
        map.off("click", layer, choose);
        map.off("mouseenter", layer, pointer);
        map.off("mouseleave", layer, plain);
      }
    };
  }, [map, onSelect]);

  return null;
};

export const ListingsLegend = ({ data, colours }: OverlayProps) => {
  const scores = spread(
    data.properties.flatMap((property) => (property.ranking.kind === "scored" ? [property.ranking.total] : [])),
  );
  if (scores === null) {
    return null;
  }
  return (
    <div className="legend">
      <span
        className="legend-ramp"
        style={{
          background: `linear-gradient(90deg in lch, ${colours.error}, ${colours.between}, ${colours.success})`,
        }}
      />
      <span className="legend-ends">
        <span>{formatPoints(scores.low)}</span>
        <span>{formatPoints(scores.high)}</span>
      </span>
      <span className="legend-note">
        <span className="legend-dot" style={{ background: colours.muted }} /> Ruled out
      </span>
    </div>
  );
};
