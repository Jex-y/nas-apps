import { requestJson } from "@apps/core/web";
import { useQuery } from "@tanstack/react-query";
import { History, PET_API } from "../../../../contract";

export const historyKey = ["history"] as const;

export const useHistory = () =>
  useQuery({
    queryKey: historyKey,
    queryFn: () => requestJson(`${PET_API}/history`, History),
    refetchInterval: 5 * 60_000,
  });
