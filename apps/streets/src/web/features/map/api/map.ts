import { requestJson } from "@apps/core/web";
import { useQueries, useQuery } from "@tanstack/react-query";
import { type Box, CELLS, MAP_TILES } from "../../../../api/geo";
import { MapView, STREETS_API, StreetNodeList } from "../../../../contract";

/**
 * The tiles to draw a viewport. Segments belong to the cell they start in and reach at most a cell beyond it, so the
 * ring of cells around the viewport is included.
 */
export const tilesIn = (viewport: Box): number[] => [...new Set(CELLS.cellsIn(viewport, 1).map(MAP_TILES.tileOf))];

/** Each tile is its own query, so a pan only fetches the tiles it brings into view. */
export const useMapTiles = (tiles: readonly number[]) =>
  useQueries({
    queries: tiles.map((tile) => ({
      queryKey: ["map", tile],
      queryFn: () => requestJson(`${STREETS_API}/map/${tile}`, MapView),
    })),
  });

export const useStreetNodes = (streetId: number | null) =>
  useQuery({
    queryKey: ["street-nodes", streetId],
    queryFn: () => requestJson(`${STREETS_API}/streets/${streetId}/nodes`, StreetNodeList),
    enabled: streetId !== null,
  });
