import type { LayerSpecification } from "maplibre-gl";
import { useMemo } from "react";
import { priceFeatures, spread } from "../utils/features";
import { useOverlay } from "./MapCanvas";
import type { OverlayProps } from "./overlay";

const ID = "price";

const pounds = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;

const perSqftSpread = (data: OverlayProps["data"]) =>
  spread(priceFeatures(data).features.map((feature) => Number(feature.properties?.perSqft)));

/**
 * Price per sq ft around each listing, as soft discs that blend where listings cluster: green where it is cheap for
 * the area you are searching, red where it is dear.
 */
export const PriceOverlay = ({ data, colours, visible }: OverlayProps) => {
  const features = useMemo(() => priceFeatures(data), [data]);
  const range = perSqftSpread(data);
  const low = range?.low ?? 0;
  const high = range?.high ?? 1;
  const layers = useMemo(
    (): LayerSpecification[] => [
      {
        id: ID,
        type: "circle",
        source: ID,
        paint: {
          "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 10, 10, 13, 32, 16, 180],
          "circle-color": [
            "interpolate-hcl",
            ["linear"],
            ["get", "perSqft"],
            low,
            colours.success,
            (low + high) / 2,
            colours.between,
            high,
            colours.error,
          ],
          "circle-opacity": 0.45,
          "circle-blur": 0.9,
        },
      },
    ],
    [colours, low, high],
  );
  useOverlay({ id: ID, data: features, layers, visible });
  return null;
};

export const PriceLegend = ({ data, colours }: OverlayProps) => {
  const range = perSqftSpread(data);
  if (range === null) {
    return null;
  }
  return (
    <div className="legend">
      <span
        className="legend-ramp"
        style={{
          background: `linear-gradient(90deg in lch, ${colours.success}, ${colours.between}, ${colours.error})`,
        }}
      />
      <span className="legend-ends">
        <span>{pounds(range.low)}</span>
        <span>{pounds(range.high)} per sq ft</span>
      </span>
    </div>
  );
};
