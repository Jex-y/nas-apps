import { requestJson } from "@apps/core/web";
import { useQuery } from "@tanstack/react-query";
import { ActivityList, STREETS_API } from "../../../../contract";

export const useActivities = () =>
  useQuery({ queryKey: ["activities"], queryFn: () => requestJson(`${STREETS_API}/activities`, ActivityList) });
