import { requestJson } from "@apps/core/web";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { CrimeCells, FLATS_API, type MapBounds, MapData } from "../../../../contract";

export const useMapData = () =>
  useQuery({ queryKey: ["map"], queryFn: () => requestJson(`${FLATS_API}/map`, MapData) });

/** Rounded so a nudge of the map does not refetch, and so equal views share a cache entry. */
const key = (bounds: MapBounds) =>
  Object.fromEntries(Object.entries(bounds).map(([side, value]) => [side, value.toFixed(3)]));

/** Crime in view; keeps showing the last cells while the next load, so panning does not blink. */
export const useCrimeCells = (bounds: MapBounds | null) =>
  useQuery({
    queryKey: ["map", "crime", bounds === null ? null : key(bounds)],
    queryFn:
      bounds === null
        ? skipToken
        : () => requestJson(`${FLATS_API}/map/crime?${new URLSearchParams(key(bounds))}`, CrimeCells),
    placeholderData: keepPreviousData,
    staleTime: 60 * 60_000,
  });
