import { requestJson } from "@apps/core/web";
import { useQuery } from "@tanstack/react-query";
import { HoldingList, type ImportHl, ImportResult, MONEY_API } from "../../../../contract";
import { useMoneyMutation } from "../../../hooks/useMoneyMutation";
import { MONEY_KEY, sendJson } from "../../../utils/request";

export const useHoldings = () =>
  useQuery({
    queryKey: [...MONEY_KEY, "holdings"],
    queryFn: () => requestJson(`${MONEY_API}/holdings`, HoldingList),
  });

export const useSetSymbol = () =>
  useMoneyMutation(({ code, symbol }: { code: string; symbol: string | null }) =>
    requestJson(`${MONEY_API}/securities/${encodeURIComponent(code)}`, HoldingList, sendJson("PUT", { symbol })),
  );

export const useImportHl = () =>
  useMoneyMutation((input: ImportHl) => requestJson(`${MONEY_API}/imports/hl`, ImportResult, sendJson("POST", input)));
