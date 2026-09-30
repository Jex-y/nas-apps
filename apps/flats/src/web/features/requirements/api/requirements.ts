import { requestJson } from "@apps/core/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FLATS_API, Requirements, Trial, Workbench } from "../../../../contract";

const requirementsKey = ["requirements"] as const;
const workbenchKey = [...requirementsKey, "workbench"] as const;
/** Properties carry their rankings and statuses, which the requirements decide. */
const propertiesKey = ["properties"] as const;

export const useRequirements = () =>
  useQuery({ queryKey: requirementsKey, queryFn: () => requestJson(`${FLATS_API}/requirements`, Requirements) });

export const useWorkbench = () =>
  useQuery({ queryKey: workbenchKey, queryFn: () => requestJson(`${FLATS_API}/requirements/workbench`, Workbench) });

export const useSaveRequirements = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requirements: Requirements) =>
      requestJson(`${FLATS_API}/requirements`, Requirements, { method: "PUT", body: JSON.stringify(requirements) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(requirementsKey, saved);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: propertiesKey }),
        queryClient.invalidateQueries({ queryKey: workbenchKey }),
      ]);
    },
  });
};

/** How `requirements` judges one property; Jev is asked whatever it has not answered in the same words. */
export const tryOn = (requirements: Requirements, propertyId: string, signal: AbortSignal): Promise<Trial> =>
  requestJson(`${FLATS_API}/requirements/trial`, Trial, {
    method: "POST",
    body: JSON.stringify({ requirements, propertyId }),
    signal,
  });
