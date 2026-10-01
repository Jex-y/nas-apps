import { requestJson } from "@apps/core/web";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MONEY_API, NetWorthSeries } from "../../../../contract";
import { MONEY_KEY } from "../../../utils/request";

/** Holds the last range's series while another loads, so the chart keeps its frame. */
export const useNetWorth = (months: number) =>
  useQuery({
    queryKey: [...MONEY_KEY, "net-worth", months],
    queryFn: () => requestJson(`${MONEY_API}/net-worth?months=${months}`, NetWorthSeries),
    placeholderData: keepPreviousData,
  });
