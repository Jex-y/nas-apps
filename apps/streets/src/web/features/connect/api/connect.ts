import { requestEmpty, requestJson } from "@apps/core/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NetworkStatus, STREETS_API, StravaStatus, type UpdateStrava, UploadResult } from "../../../../contract";

const stravaKey = ["strava"] as const;
const networkKey = ["network"] as const;

/** Refreshed every few seconds while a backfill or import is under way, so its progress is visible. */
const LIVE_MS = 5_000;

export const useStravaStatus = () =>
  useQuery({
    queryKey: stravaKey,
    queryFn: () => requestJson(`${STREETS_API}/strava`, StravaStatus),
    refetchInterval: (query) =>
      query.state.data?.connection?.backfill === "running" || (query.state.data?.activities.pending ?? 0) > 0
        ? LIVE_MS
        : false,
  });

export const useNetworkStatus = () =>
  useQuery({
    queryKey: networkKey,
    queryFn: () => requestJson(`${STREETS_API}/network`, NetworkStatus),
    refetchInterval: (query) => (query.state.data?.refresh?.finishedAt === null ? LIVE_MS : false),
  });

const useStravaMutation = <T, R>(mutationFn: (input: T) => Promise<R>) => {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries({ queryKey: stravaKey }) });
};

export const useUpdateStrava = () =>
  useStravaMutation((input: UpdateStrava) =>
    requestJson(`${STREETS_API}/strava`, StravaStatus, { method: "PATCH", body: JSON.stringify(input) }),
  );

export const useDisconnectStrava = () =>
  useStravaMutation(() => requestEmpty(`${STREETS_API}/strava`, { method: "DELETE" }));

export const useRescan = () =>
  useStravaMutation(() => requestEmpty(`${STREETS_API}/strava/backfill`, { method: "POST" }));

/** One file per request, so an armful from Strava's export never has to fit in the server's memory at once. */
export const uploadGpx = (file: File) => {
  const body = new FormData();
  body.set("file", file);
  return requestJson(`${STREETS_API}/uploads`, UploadResult, { method: "POST", body });
};

export const useRefreshNetwork = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requestEmpty(`${STREETS_API}/network/refresh`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: networkKey }),
  });
};
