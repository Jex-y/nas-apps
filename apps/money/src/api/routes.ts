import {
  defineRoutes,
  HttpError,
  type IdentityMode,
  parseBody,
  parseParam,
  parseQuery,
  resolveViewer,
} from "@apps/core";
import { z } from "zod";
import {
  CreateAccount,
  ImportHl,
  NetWorthQuery,
  RenameTag,
  SetBalance,
  SetSymbol,
  SpendingQuery,
  SplitTransaction,
  StartAuthorisation,
  TagName,
  type TransactionFilter,
  UpdateAccount,
} from "../contract";
import type { MoneyService } from "./service";
import type { Cursor } from "./views";

export type MoneyRoutesDeps = {
  readonly service: MoneyService;
  readonly identity: IdentityMode;
};

const id = (value: string) => parseParam(value, z.uuid());
const day = (value: string) => parseParam(value, z.iso.date());
const tagName = (value: string) => parseParam(value, TagName);

const TransactionQuery = z
  .object({
    accountId: z.uuid().optional(),
    tag: TagName.optional(),
    untagged: z.literal("true").optional(),
    q: z.string().trim().min(1).max(100).optional(),
    before: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}_[0-9a-f-]{36}$/)
      .optional(),
  })
  .refine((query) => query.tag === undefined || query.untagged === undefined, {
    message: "Filter by a tag or by untagged, not both",
  });

const filterOf = (query: z.infer<typeof TransactionQuery>): TransactionFilter => ({
  accountId: query.accountId ?? null,
  tags:
    query.tag !== undefined
      ? { kind: "tagged", name: query.tag }
      : query.untagged !== undefined
        ? { kind: "untagged" }
        : { kind: "any" },
  search: query.q ?? null,
});

const cursorOf = (before: string | undefined): Cursor | null => {
  const [bookedOn, id] = before?.split("_") ?? [];
  return bookedOn === undefined || id === undefined ? null : { bookedOn, id };
};

const InstitutionQuery = z.object({ country: z.string().length(2).toUpperCase().default("GB") });

/** Where the browser lands after a bank login, told how it went. */
const accountsPage = (outcome: { readonly linked: true } | { readonly error: string }) =>
  new Response(null, {
    status: 303,
    headers: {
      Location: `/money/accounts?${"linked" in outcome ? "linked=1" : `error=${encodeURIComponent(outcome.error)}`}`,
    },
  });

export const createMoneyRoutes = ({ service, identity }: MoneyRoutesDeps) => {
  /** Every request acts on the viewer's own money. */
  const respond =
    <R extends Request>(handle: (owner: string, request: R) => Promise<unknown>, status = 200) =>
    async (request: R) => {
      const { login } = resolveViewer(identity, request);
      return Response.json(await handle(login, request), { status });
    };

  return defineRoutes({
    "/money/api/accounts": {
      GET: respond((owner) => service.accounts(owner)),
      POST: respond(
        async (owner, request) => service.createAccount(owner, await parseBody(request, CreateAccount)),
        201,
      ),
    },
    "/money/api/accounts/:id": {
      PATCH: respond(async (owner, request) =>
        service.updateAccount(owner, id(request.params.id), await parseBody(request, UpdateAccount)),
      ),
      DELETE: respond((owner, request) => service.deleteAccount(owner, id(request.params.id))),
    },
    "/money/api/accounts/:id/balances": {
      GET: respond((owner, request) => service.balances(owner, id(request.params.id))),
    },
    "/money/api/accounts/:id/balances/:date": {
      PUT: respond(async (owner, request) =>
        service.setBalance(
          owner,
          id(request.params.id),
          day(request.params.date),
          (await parseBody(request, SetBalance)).amount,
        ),
      ),
      DELETE: respond((owner, request) =>
        service.deleteBalance(owner, id(request.params.id), day(request.params.date)),
      ),
    },
    "/money/api/net-worth": {
      GET: respond((owner, request) => service.netWorth(owner, parseQuery(request, NetWorthQuery).months)),
    },
    "/money/api/transactions": {
      GET: respond((owner, request) => {
        const query = parseQuery(request, TransactionQuery);
        return service.transactions(owner, filterOf(query), cursorOf(query.before));
      }),
    },
    "/money/api/transactions/:id/items": {
      PUT: respond(async (owner, request) =>
        service.splitTransaction(owner, id(request.params.id), await parseBody(request, SplitTransaction)),
      ),
    },
    "/money/api/tags": {
      GET: respond((owner) => service.tags(owner)),
    },
    "/money/api/tags/:name": {
      PATCH: respond(async (owner, request) =>
        service.renameTag(owner, tagName(request.params.name), (await parseBody(request, RenameTag)).name),
      ),
      DELETE: respond((owner, request) => service.deleteTag(owner, tagName(request.params.name))),
    },
    "/money/api/spending": {
      GET: respond((owner, request) => service.spending(owner, parseQuery(request, SpendingQuery).months)),
    },
    "/money/api/holdings": {
      GET: respond((owner) => service.holdings(owner)),
    },
    "/money/api/securities/:code": {
      PUT: respond(async (owner, request) =>
        service.setSymbol(owner, request.params.code, (await parseBody(request, SetSymbol)).symbol),
      ),
    },
    "/money/api/imports/hl": {
      POST: respond(async (owner, request) => {
        const { csv, accountId } = await parseBody(request, ImportHl);
        return service.importHl(owner, csv, accountId);
      }),
    },
    "/money/api/banking": {
      GET: respond((owner) => service.banking(owner)),
    },
    "/money/api/bank/institutions": {
      GET: respond((_, request) => service.institutions(parseQuery(request, InstitutionQuery).country)),
    },
    "/money/api/bank/authorisations": {
      POST: respond(async (owner, request) =>
        service.startAuthorisation(owner, (await parseBody(request, StartAuthorisation)).institution),
      ),
    },
    /** The bank sends the browser here, so the answer is a page to land on rather than JSON. */
    "/money/api/bank/callback": {
      GET: async (request) => {
        const { login } = resolveViewer(identity, request);
        const params = new URL(request.url).searchParams;
        const [code, state] = [params.get("code"), z.uuid().safeParse(params.get("state"))];
        if (code === null || !state.success) {
          return accountsPage({
            error: params.get("error_description") ?? params.get("error") ?? "The bank did not complete the login",
          });
        }
        try {
          await service.completeAuthorisation(login, state.data, code);
          return accountsPage({ linked: true });
        } catch (error) {
          if (error instanceof HttpError) {
            return accountsPage({ error: error.message });
          }
          throw error;
        }
      },
    },
    "/money/api/connections/:id/sync": {
      POST: async (request) => {
        await service.syncConnection(resolveViewer(identity, request).login, id(request.params.id));
        return new Response(null, { status: 202 });
      },
    },
    "/money/api/connections/:id": {
      DELETE: respond((owner, request) => service.disconnect(owner, id(request.params.id))),
    },
  });
};
