import { requestJson } from "@apps/core/web";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  MONEY_API,
  type SplitTransaction,
  TagList,
  Transaction,
  type TransactionFilter,
  TransactionPage,
} from "../../../../contract";
import { useMoneyMutation } from "../../../hooks/useMoneyMutation";
import { MONEY_KEY, sendJson } from "../../../utils/request";

const queryOf = ({ accountId, tags, search }: TransactionFilter, before: string | null): string => {
  const params = new URLSearchParams();
  if (accountId !== null) {
    params.set("accountId", accountId);
  }
  if (tags.kind === "tagged") {
    params.set("tag", tags.name);
  }
  if (tags.kind === "untagged") {
    params.set("untagged", "true");
  }
  if (search !== null) {
    params.set("q", search);
  }
  if (before !== null) {
    params.set("before", before);
  }
  return params.toString();
};

/** Newest first, a page at a time; keeps the last filter's rows on screen while the next loads. */
export const useTransactions = (filter: TransactionFilter) =>
  useInfiniteQuery({
    queryKey: [...MONEY_KEY, "transactions", filter],
    queryFn: ({ pageParam }) => requestJson(`${MONEY_API}/transactions?${queryOf(filter, pageParam)}`, TransactionPage),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next,
    placeholderData: keepPreviousData,
  });

export const useSplitTransaction = () =>
  useMoneyMutation(({ transactionId, split }: { transactionId: string; split: SplitTransaction }) =>
    requestJson(`${MONEY_API}/transactions/${transactionId}/items`, Transaction, sendJson("PUT", split)),
  );

export const useTags = () =>
  useQuery({
    queryKey: [...MONEY_KEY, "tags"],
    queryFn: () => requestJson(`${MONEY_API}/tags`, TagList),
  });

const tagPath = (name: string) => `${MONEY_API}/tags/${encodeURIComponent(name)}`;

export const useRenameTag = () =>
  useMoneyMutation(({ name, to }: { name: string; to: string }) =>
    requestJson(tagPath(name), TagList, sendJson("PATCH", { name: to })),
  );

export const useDeleteTag = () =>
  useMoneyMutation((name: string) => requestJson(tagPath(name), TagList, sendJson("DELETE")));
