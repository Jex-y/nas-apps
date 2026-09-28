import { requestJson } from "@nas/core/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Hatch, type Interaction, PET_API, PetView, type UpdatePet } from "../../../../contract";
import { historyKey } from "../../history/api/history";

export const petKey = ["pet"] as const;

export const usePet = () =>
  useQuery({
    queryKey: petKey,
    queryFn: () => requestJson(`${PET_API}/state`, PetView),
    refetchInterval: 60_000,
  });

/** Every change answers with the pet as it now is, so the screen updates without another round trip. */
const usePetMutation = <T>(mutationFn: (input: T) => Promise<PetView>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (view) => {
      queryClient.setQueryData(petKey, view);
      return queryClient.invalidateQueries({ queryKey: historyKey });
    },
  });
};

export const useHatch = () =>
  usePetMutation((input: Hatch) =>
    requestJson(`${PET_API}/pet`, PetView, { method: "POST", body: JSON.stringify(input) }),
  );

export const useUpdatePet = () =>
  usePetMutation((update: UpdatePet) =>
    requestJson(`${PET_API}/pet`, PetView, { method: "PATCH", body: JSON.stringify(update) }),
  );

export const useInteract = () =>
  usePetMutation((kind: Interaction) =>
    requestJson(`${PET_API}/interactions`, PetView, { method: "POST", body: JSON.stringify({ kind }) }),
  );
