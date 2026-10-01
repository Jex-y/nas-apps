import { requestJson } from "@apps/core/web";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MONEY_API, Spending } from "../../../../contract";
import { MONEY_KEY } from "../../../utils/request";

export const useSpending = (months: number) =>
  useQuery({
    queryKey: [...MONEY_KEY, "spending", months],
    queryFn: () => requestJson(`${MONEY_API}/spending?months=${months}`, Spending),
    placeholderData: keepPreviousData,
  });
