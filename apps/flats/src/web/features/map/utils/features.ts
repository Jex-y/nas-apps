import type { FeatureCollection, Feature as GeoFeature, Point } from "geojson";
import type { MapData, MapProperty } from "../../../../contract";

type Feature = GeoFeature<Point>;

const point = (longitude: number, latitude: number, properties: Record<string, unknown>): Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [longitude, latitude] },
  properties,
});

const collection = (features: readonly Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features: [...features],
});

/** Whether a property is still being weighed: not rejected by you, and not ruled out by a limit or Jev. */
export const inPlay = (property: MapProperty) => property.status !== "rejected" && property.ranking.kind === "scored";

/** Each listing, scored or not; `score` is absent for one ruled out. */
export const listingFeatures = (data: MapData, showRejected: boolean) =>
  collection(
    data.properties
      .filter((property) => showRejected || property.status !== "rejected")
      .map((property) =>
        point(property.longitude, property.latitude, {
          id: property.id,
          standing: inPlay(property) ? "in" : "out",
          ...(property.ranking.kind === "scored" && { score: property.ranking.total }),
        }),
      ),
  );

const poundsPerSqft = ({ price, sizeSqft }: Pick<MapProperty, "price" | "sizeSqft">) =>
  price !== null && sizeSqft ? price / sizeSqft : null;

/** Every listing with a price and a size, weighed by its price per sq ft. */
export const priceFeatures = (data: MapData) =>
  collection(
    data.properties.flatMap((property) => {
      const perSqft = poundsPerSqft(property);
      return perSqft === null ? [] : [point(property.longitude, property.latitude, { id: property.id, perSqft })];
    }),
  );

/** The value `share` of the way through `values`, e.g. 0.1 for the 10th percentile; `null` for none. */
export const quantile = (values: readonly number[], share: number): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const at = (sorted.length - 1) * share;
  const low = sorted[Math.floor(at)] ?? 0;
  const high = sorted[Math.ceil(at)] ?? low;
  return low + (high - low) * (at - Math.floor(at));
};

/**
 * Where a colour scale over `values` starts and ends: the 10th to 90th percentile, so one outlier does not wash out
 * the rest, and never an empty range.
 */
export const spread = (values: readonly number[]): { readonly low: number; readonly high: number } | null => {
  const low = quantile(values, 0.1);
  const high = quantile(values, 0.9);
  return low === null || high === null ? null : { low, high: high > low ? high : low + 1 };
};

/** The south-west and north-east corners around every listing in play, padded, or `null` for none. */
export const boundsAround = (properties: readonly MapProperty[]) => {
  if (properties.length === 0) {
    return null;
  }
  const latitudes = properties.map((property) => property.latitude);
  const longitudes = properties.map((property) => property.longitude);
  return {
    south: Math.min(...latitudes),
    west: Math.min(...longitudes),
    north: Math.max(...latitudes),
    east: Math.max(...longitudes),
  };
};
