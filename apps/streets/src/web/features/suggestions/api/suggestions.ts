import { requestJson } from "@apps/core/web";
import { useQuery } from "@tanstack/react-query";
import { STREETS_API, SuggestionList } from "../../../../contract";

export type Start = { readonly lat: number; readonly lon: number };

export const useSuggestions = (start: Start | null) =>
  useQuery({
    queryKey: ["suggestions", start],
    queryFn: () => requestJson(`${STREETS_API}/suggestions?lat=${start?.lat}&lon=${start?.lon}`, SuggestionList),
    enabled: start !== null,
  });
