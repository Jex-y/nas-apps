import { requestEmpty, requestJson } from "@apps/core/web";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Authorisation, Banking, type Institution, InstitutionList, MONEY_API } from "../../../../contract";
import { useMoneyMutation } from "../../../hooks/useMoneyMutation";
import { MONEY_KEY, sendJson } from "../../../utils/request";

export const useBanking = () =>
  useQuery({
    queryKey: [...MONEY_KEY, "banking"],
    queryFn: () => requestJson(`${MONEY_API}/banking`, Banking),
  });

/** UK banks that can be linked; fetched only once someone goes to link one. */
export const useInstitutions = (enabled: boolean) =>
  useQuery({
    queryKey: [...MONEY_KEY, "institutions"],
    queryFn: () => requestJson(`${MONEY_API}/bank/institutions?country=GB`, InstitutionList),
    staleTime: 60 * 60_000,
    enabled,
  });

/** Leaves for the bank's own login, which comes back to the accounts page. */
export const useLinkBank = () =>
  useMutation({
    mutationFn: (institution: Institution) =>
      requestJson(`${MONEY_API}/bank/authorisations`, Authorisation, sendJson("POST", { institution })),
    onSuccess: ({ url }) => window.location.assign(url),
  });

export const useSyncConnection = () =>
  useMoneyMutation((connectionId: string) =>
    requestEmpty(`${MONEY_API}/connections/${connectionId}/sync`, sendJson("POST")),
  );

export const useDisconnect = () =>
  useMoneyMutation((connectionId: string) =>
    requestJson(`${MONEY_API}/connections/${connectionId}`, Banking, sendJson("DELETE")),
  );
