import { requestEmpty, requestJson } from "@nas/core/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CreateDestination, Destination, DestinationList, FLATS_API } from "../../../../contract";

const destinationsKey = ["destinations"] as const;
/** Properties carry their commutes, so changing the places changes them too. */
const propertiesKey = ["properties"] as const;

export const useDestinations = () =>
  useQuery({ queryKey: destinationsKey, queryFn: () => requestJson(`${FLATS_API}/destinations`, DestinationList) });

const useDestinationMutation = <T, R>(mutationFn: (input: T) => Promise<R>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: destinationsKey }),
        queryClient.invalidateQueries({ queryKey: propertiesKey }),
      ]),
  });
};

export const useCreateDestination = () =>
  useDestinationMutation((input: CreateDestination) =>
    requestJson(`${FLATS_API}/destinations`, Destination, { method: "POST", body: JSON.stringify(input) }),
  );

export const useDeleteDestination = () =>
  useDestinationMutation((id: string) => requestEmpty(`${FLATS_API}/destinations/${id}`, { method: "DELETE" }));
