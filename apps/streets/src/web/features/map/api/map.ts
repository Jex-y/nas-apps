import { requestJson } from "@nas/core/web";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MapView, STREETS_API, StreetNodeList } from "../../../../contract";

export type Viewport = { readonly south: number; readonly west: number; readonly north: number; readonly east: number };

/** Rounded outwards to about 100 m, so small pans reuse the last response instead of refetching. */
const snap = ({ south, west, north, east }: Viewport): Viewport => ({
  south: Math.floor(south * 1000) / 1000,
  west: Math.floor(west * 1000) / 1000,
  north: Math.ceil(north * 1000) / 1000,
  east: Math.ceil(east * 1000) / 1000,
});

const query = (viewport: Viewport) =>
  new URLSearchParams(Object.entries(viewport).map(([key, value]) => [key, String(value)]));

/** Only the streets in view; pass `null` when zoomed out too far to draw them. */
export const useMapStreets = (viewport: Viewport | null) => {
  const snapped = viewport && snap(viewport);
  return useQuery({
    queryKey: ["map", snapped],
    queryFn: () =>
      snapped === null ? { streets: [] } : requestJson(`${STREETS_API}/map?${query(snapped)}`, MapView),
    enabled: snapped !== null,
    placeholderData: keepPreviousData,
  });
};

export const useStreetNodes = (streetId: number | null) =>
  useQuery({
    queryKey: ["street-nodes", streetId],
    queryFn: () => requestJson(`${STREETS_API}/streets/${streetId}/nodes`, StreetNodeList),
    enabled: streetId !== null,
  });
