import { requestJson } from "@apps/core/web";
import { keepPreviousData, skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FLATS_API, Requirements, Trial } from "../../../../contract";

const requirementsKey = ["requirements"] as const;
/** Properties carry their rankings and statuses, which the requirements decide. */
const propertiesKey = ["properties"] as const;

export const useRequirements = () =>
  useQuery({ queryKey: requirementsKey, queryFn: () => requestJson(`${FLATS_API}/requirements`, Requirements) });

export const useSaveRequirements = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requirements: Requirements) =>
      requestJson(`${FLATS_API}/requirements`, Requirements, { method: "PUT", body: JSON.stringify(requirements) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(requirementsKey, saved);
      return queryClient.invalidateQueries({ queryKey: propertiesKey });
    },
  });
};

/**
 * How `draft` judges the property `propertyId`, with the draft it was tried on; keeps showing the last result while
 * the next one loads.
 */
export const useTrial = (draft: Requirements | null, propertyId: string | null) =>
  useQuery({
    queryKey: [...requirementsKey, "trial", draft, propertyId],
    queryFn:
      draft === null || propertyId === null
        ? skipToken
        : async () => ({
            draft,
            trial: await requestJson(`${FLATS_API}/requirements/trial`, Trial, {
              method: "POST",
              body: JSON.stringify({ requirements: draft, propertyId }),
            }),
          }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
