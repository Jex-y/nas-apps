import { requestJson } from "@nas/core/web";
import { useQuery } from "@tanstack/react-query";
import { STREETS_API, Stats } from "../../../../contract";

export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: () => requestJson(`${STREETS_API}/stats`, Stats) });
