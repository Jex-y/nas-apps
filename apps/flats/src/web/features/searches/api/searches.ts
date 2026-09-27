import { requestEmpty, requestJson } from "@nas/core/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CreateSearch, FLATS_API, Search, SearchList } from "../../../../contract";

const searchesKey = ["searches"] as const;

export const useSearches = () =>
  useQuery({
    queryKey: searchesKey,
    queryFn: () => requestJson(`${FLATS_API}/searches`, SearchList),
    refetchInterval: 60_000,
  });

const useSearchMutation = <T, R>(mutationFn: (input: T) => Promise<R>) => {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries({ queryKey: searchesKey }) });
};

export const useCreateSearch = () =>
  useSearchMutation((input: CreateSearch) =>
    requestJson(`${FLATS_API}/searches`, Search, { method: "POST", body: JSON.stringify(input) }),
  );

export const useToggleSearch = () =>
  useSearchMutation(({ id, enabled }: { id: string; enabled: boolean }) =>
    requestJson(`${FLATS_API}/searches/${id}`, Search, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  );

export const useDeleteSearch = () =>
  useSearchMutation((id: string) => requestEmpty(`${FLATS_API}/searches/${id}`, { method: "DELETE" }));
