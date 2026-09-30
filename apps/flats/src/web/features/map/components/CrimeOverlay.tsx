import type { FeatureCollection } from "geojson";
import type { LayerSpecification } from "maplibre-gl";
import { useMemo } from "react";
import { crimePeriod } from "../../properties/utils/crime";
import { useCrimeCells } from "../api/map";
import { withAlpha } from "../hooks/useThemeColours";
import { quantile } from "../utils/features";
import { useOverlay } from "./MapCanvas";
import type { OverlayProps } from "./overlay";

const ID = "crime";

/** Street crime as a heatmap, from the reports stored around your flats, fetched for whatever is in view. */
export const CrimeOverlay = ({ colours, visible, view }: OverlayProps) => {
  const crime = useCrimeCells(visible ? view : null);
  const cells = crime.data?.cells ?? [];
  // Scaled to the busy end rather than the busiest cell, which is often one station or high street.
  const busy = Math.max(
    1,
    quantile(
      cells.map((cell) => cell.count),
      0.95,
    ) ?? 1,
  );
  const features = useMemo(
    (): FeatureCollection => ({
      type: "FeatureCollection",
      features: cells.map((cell) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [cell.longitude, cell.latitude] },
        properties: { weight: Math.min(1, cell.count / busy) },
      })),
    }),
    [cells, busy],
  );
  const layers = useMemo(
    (): LayerSpecification[] => [
      {
        id: ID,
        type: "heatmap",
        source: ID,
        paint: {
          "heatmap-weight": ["get", "weight"],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.7, 15, 1.3],
          "heatmap-radius": ["interpolate", ["exponential", 2], ["zoom"], 10, 9, 13, 28, 16, 130],
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            withAlpha(colours.error, 0),
            0.2,
            withAlpha(colours.error, 0.1),
            0.5,
            withAlpha(colours.error, 0.45),
            0.8,
            withAlpha(colours.error, 0.8),
            1,
            colours.error,
          ],
          "heatmap-opacity": 0.8,
        },
      },
    ],
    [colours],
  );
  useOverlay({ id: ID, data: features, layers, visible });
  return null;
};

export const CrimeLegend = ({ colours, visible, view }: OverlayProps) => {
  const crime = useCrimeCells(visible ? view : null);
  const through = crime.data?.throughMonth ?? null;
  return (
    <div className="legend">
      <span
        className="legend-ramp"
        style={{ background: `linear-gradient(90deg, ${withAlpha(colours.error, 0)}, ${colours.error})` }}
      />
      <span className="legend-ends">
        <span>Fewer</span>
        <span>More crime</span>
      </span>
      <span className="legend-note">
        {through === null
          ? "Counted once your flats are, from police.uk."
          : `${crimePeriod(through, crime.data?.months ?? 12)}, around your flats, from police.uk.`}
      </span>
    </div>
  );
};
