import { requestJson } from "@nas/core/web";
import { useQuery } from "@tanstack/react-query";
import { REFRESH_MS, STATUS_API, StatusReport } from "../../../../contract";

export const useStatusReport = () =>
  useQuery({
    queryKey: ["report"],
    queryFn: () => requestJson(`${STATUS_API}/report`, StatusReport),
    refetchInterval: REFRESH_MS,
  });
