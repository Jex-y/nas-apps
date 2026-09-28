import { requestEmpty, requestJson } from "@nas/core/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CreateMapLayer, FLATS_API, MapLayer, MapLayerList, type MapStroke } from "../../../../contract";

const layersKey = ["map-layers"] as const;

export const useMapLayers = () =>
  useQuery({ queryKey: layersKey, queryFn: () => requestJson(`${FLATS_API}/map/layers`, MapLayerList) });

/**
 * Applies `change` to the cached layers at once, so drawing never waits on the network; a failed save refetches the
 * server's truth rather than leaving the map showing what was never stored.
 */
const useOptimisticMutation = <T>(
  mutationFn: (input: T) => Promise<void>,
  change: (layers: readonly MapLayer[], input: T) => MapLayer[],
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: layersKey });
      queryClient.setQueryData<MapLayer[]>(layersKey, (layers) => layers && change(layers, input));
    },
    onError: () => queryClient.invalidateQueries({ queryKey: layersKey }),
  });
};

export const useCreateLayer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMapLayer) =>
      requestJson(`${FLATS_API}/map/layers`, MapLayer, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (created) => queryClient.setQueryData<MapLayer[]>(layersKey, (layers) => [...(layers ?? []), created]),
  });
};

export const useUpdateLayer = () =>
  useOptimisticMutation(
    ({ id, update }: { id: string; update: Partial<Pick<MapLayer, "name" | "colour" | "visible">> }) =>
      requestEmpty(`${FLATS_API}/map/layers/${id}`, { method: "PATCH", body: JSON.stringify(update) }),
    (layers, { id, update }) => layers.map((layer) => (layer.id === id ? { ...layer, ...update } : layer)),
  );

export const useDeleteLayer = () =>
  useOptimisticMutation(
    (id: string) => requestEmpty(`${FLATS_API}/map/layers/${id}`, { method: "DELETE" }),
    (layers, id) => layers.filter((layer) => layer.id !== id),
  );

export const useAddStroke = () =>
  useOptimisticMutation(
    ({ layerId, stroke }: { layerId: string; stroke: MapStroke }) =>
      requestEmpty(`${FLATS_API}/map/layers/${layerId}/strokes`, { method: "POST", body: JSON.stringify(stroke) }),
    (layers, { layerId, stroke }) =>
      layers.map((layer) => (layer.id === layerId ? { ...layer, strokes: [...layer.strokes, stroke] } : layer)),
  );

export const useEraseStroke = () =>
  useOptimisticMutation(
    (id: string) => requestEmpty(`${FLATS_API}/map/strokes/${id}`, { method: "DELETE" }),
    (layers, id) => layers.map((layer) => ({ ...layer, strokes: layer.strokes.filter((stroke) => stroke.id !== id) })),
  );
