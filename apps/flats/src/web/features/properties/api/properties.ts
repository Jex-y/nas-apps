import { requestEmpty, requestJson } from "@nas/core/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CreateViewing,
  FLATS_API,
  PropertyDetail,
  PropertyList,
  type PropertyStatus,
  type UpdateStatus,
} from "../../../../contract";

const keys = {
  all: ["properties"] as const,
  list: (status: PropertyStatus | "all") => ["properties", "list", status] as const,
  detail: (id: string) => ["properties", "detail", id] as const,
};

export const useProperties = (status: PropertyStatus | "all") =>
  useQuery({
    queryKey: keys.list(status),
    queryFn: () =>
      requestJson(
        status === "all" ? `${FLATS_API}/properties` : `${FLATS_API}/properties?status=${status}`,
        PropertyList,
      ),
  });

export const useProperty = (id: string) =>
  useQuery({ queryKey: keys.detail(id), queryFn: () => requestJson(`${FLATS_API}/properties/${id}`, PropertyDetail) });

const useInvalidatingMutation = <T>(mutationFn: (input: T) => Promise<void>) => {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.all }) });
};

export const useUpdateStatus = () =>
  useInvalidatingMutation(({ id, update }: { id: string; update: UpdateStatus }) =>
    requestEmpty(`${FLATS_API}/properties/${id}/status`, { method: "PUT", body: JSON.stringify(update) }),
  );

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
