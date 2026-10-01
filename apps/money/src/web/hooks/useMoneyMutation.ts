import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MONEY_KEY } from "../utils/request";

/** Makes a change, then refetches everything shown: one change moves balances, totals and lists alike. */
export const useMoneyMutation = <T, R>(mutationFn: (input: T) => Promise<R>) => {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries({ queryKey: MONEY_KEY }) });
};
