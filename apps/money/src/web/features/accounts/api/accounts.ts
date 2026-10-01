import { requestJson } from "@apps/core/web";
import { useQuery } from "@tanstack/react-query";
import { AccountList, BalanceList, type CreateAccount, MONEY_API, type UpdateAccount } from "../../../../contract";
import { useMoneyMutation } from "../../../hooks/useMoneyMutation";
import { MONEY_KEY, sendJson } from "../../../utils/request";

export const useAccounts = () =>
  useQuery({
    queryKey: [...MONEY_KEY, "accounts"],
    queryFn: () => requestJson(`${MONEY_API}/accounts`, AccountList),
    refetchInterval: 5 * 60_000,
  });

export const useCreateAccount = () =>
  useMoneyMutation((input: CreateAccount) =>
    requestJson(`${MONEY_API}/accounts`, AccountList, sendJson("POST", input)),
  );

export const useUpdateAccount = () =>
  useMoneyMutation(({ accountId, update }: { accountId: string; update: UpdateAccount }) =>
    requestJson(`${MONEY_API}/accounts/${accountId}`, AccountList, sendJson("PATCH", update)),
  );

export const useDeleteAccount = () =>
  useMoneyMutation((accountId: string) =>
    requestJson(`${MONEY_API}/accounts/${accountId}`, AccountList, sendJson("DELETE")),
  );

export const useBalances = (accountId: string) =>
  useQuery({
    queryKey: [...MONEY_KEY, "balances", accountId],
    queryFn: () => requestJson(`${MONEY_API}/accounts/${accountId}/balances`, BalanceList),
  });

type BalanceOn = { readonly accountId: string; readonly date: string };

export const useSetBalance = () =>
  useMoneyMutation(({ accountId, date, amount }: BalanceOn & { readonly amount: number }) =>
    requestJson(`${MONEY_API}/accounts/${accountId}/balances/${date}`, BalanceList, sendJson("PUT", { amount })),
  );

export const useDeleteBalance = () =>
  useMoneyMutation(({ accountId, date }: BalanceOn) =>
    requestJson(`${MONEY_API}/accounts/${accountId}/balances/${date}`, BalanceList, sendJson("DELETE")),
  );
