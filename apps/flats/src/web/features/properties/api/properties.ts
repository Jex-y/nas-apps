import { requestEmpty, requestJson } from "@apps/core/web";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CreateViewing,
  FLATS_API,
  PropertyDetail,
  PropertyList,
  type PropertyStatus,
  type PropertySummary,
  type UpdateStatus,
} from "../../../../contract";
import { bestFirst } from "../utils/ranking";

const keys = {
  all: ["properties"] as const,
  list: (status: PropertyStatus | "all") => ["properties", "list", status] as const,
  detail: (id: string) => ["properties", "detail", id] as const,
  triage: ["properties", "triage"] as const,
};

const listQuery = (status: PropertyStatus | "all") =>
  queryOptions({
    queryKey: keys.list(status),
    queryFn: () =>
      requestJson(
        status === "all" ? `${FLATS_API}/properties` : `${FLATS_API}/properties?status=${status}`,
        PropertyList,
      ),
  });

export const useProperties = (status: PropertyStatus | "all") => useQuery(listQuery(status));

/** New properties best first, excluded ones last. */
export const useInbox = () => useQuery({ ...listQuery("new"), select: bestFirst });

const detailQuery = (id: string) =>
  queryOptions({
    queryKey: keys.detail(id),
    queryFn: () => requestJson(`${FLATS_API}/properties/${id}`, PropertyDetail),
  });

export const useProperty = (id: string) => useQuery(detailQuery(id));

/** Photos then floorplans, from the detail; nothing while `id` is undefined. */
export const usePhotos = (id: string | undefined) =>
  useQuery({ ...detailQuery(id ?? ""), enabled: id !== undefined, select: (detail) => detail.photos });

const useInvalidatingMutation = <T>(mutationFn: (input: T) => Promise<void>) => {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.all }) });
};

const putStatus = (id: string, update: UpdateStatus) =>
  requestEmpty(`${FLATS_API}/properties/${id}/status`, { method: "PUT", body: JSON.stringify(update) });

export const useUpdateStatus = () =>
  useInvalidatingMutation(({ id, update }: { id: string; update: UpdateStatus }) => putStatus(id, update));

/**
 * Moves a property into or out of the new list at once rather than after the round trip. Refetching waits for the
 * last triage in flight: an earlier one settling mid-burst would refetch a list that still holds the later ones.
 */
export const useTriage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: keys.triage,
    mutationFn: ({ property, update }: { property: PropertySummary; update: UpdateStatus }) =>
      putStatus(property.id, update),
    onMutate: async ({ property, update }) => {
      await queryClient.cancelQueries({ queryKey: keys.list("new") });
      queryClient.setQueryData<PropertySummary[]>(keys.list("new"), (list) => {
        const others = list?.filter((other) => other.id !== property.id);
        return others && (update.status === "new" ? [property, ...others] : others);
      });
    },
    onSettled: () =>
      queryClient.isMutating({ mutationKey: keys.triage }) === 1
        ? queryClient.invalidateQueries({ queryKey: keys.all })
        : undefined,
  });
};

export const useUpdateNotes = () =>
  useInvalidatingMutation(({ id, notes }: { id: string; notes: string }) =>
    requestEmpty(`${FLATS_API}/properties/${id}/notes`, { method: "PUT", body: JSON.stringify({ notes }) }),
  );

export const useAddViewing = () =>
  useInvalidatingMutation(({ id, viewing }: { id: string; viewing: CreateViewing }) =>
    requestEmpty(`${FLATS_API}/properties/${id}/viewings`, { method: "POST", body: JSON.stringify(viewing) }),
  );

export const useDeleteViewing = () =>
  useInvalidatingMutation((id: string) => requestEmpty(`${FLATS_API}/viewings/${id}`, { method: "DELETE" }));

export const useUploadViewingPhoto = () =>
  useInvalidatingMutation(({ viewingId, file }: { viewingId: string; file: File }) => {
    const body = new FormData();
    body.set("file", file);
    return requestEmpty(`${FLATS_API}/viewings/${viewingId}/photos`, { method: "POST", body });
  });

export const useAddListing = () =>
  useInvalidatingMutation((url: string) =>
    requestEmpty(`${FLATS_API}/listings`, { method: "POST", body: JSON.stringify({ url }) }),
  );
