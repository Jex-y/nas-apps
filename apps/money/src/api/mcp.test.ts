import { describe, expect, test } from "bun:test";
import { callTool, connectMcp, startTestServer, uniqueLogin } from "@apps/core/testing";
import { createMoneyTestContext, fakePrices, HL_HOLDINGS, NOW } from "../../test/support";
import { createMoneyApp } from "../module";

const context = createMoneyTestContext();
const request = startTestServer(
  (ctx) => [createMoneyApp(ctx, { bank: null, prices: fakePrices().prices, now: () => NOW })],
  context,
);

describe("money mcp", () => {
  test("reads net worth and keeps manual accounts, as the connected person only", async () => {
    const me = await connectMcp(request, "/money/mcp", uniqueLogin());
    const [flat] = JSON.parse((await callTool(me, "create_money_account", { name: "Flat", kind: "property" })).text);
    await callTool(me, "set_account_balance", { accountId: flat.id, date: "2026-08-31", amount: 40_000_000 });
    await callTool(me, "set_account_balance", { accountId: flat.id, date: "2026-09-10", amount: 41_000_000 });
    await callTool(me, "import_hl_export", { csv: HL_HOLDINGS });

    const worth = JSON.parse((await callTool(me, "get_net_worth", { months: 3 })).text);
    expect(worth.total).toBe(41_000_000 + 1_249_770);
    expect(worth.accounts.map((account: { name: string }) => account.name)).toEqual(["HL Stocks & Shares ISA", "Flat"]);
    expect(worth.history.map((point: { date: string; total: number }) => [point.date, point.total])).toEqual([
      ["2026-08-31", 40_000_000],
      ["2026-09-21", 41_000_000 + 1_249_770],
    ]);
    expect(JSON.parse((await callTool(me, "list_holdings")).text)).toHaveLength(2);

    const someone = await connectMcp(request, "/money/mcp", uniqueLogin());
    expect(JSON.parse((await callTool(someone, "get_net_worth")).text)).toEqual({
      total: 0,
      accounts: [],
      history: [],
    });
    expect(await callTool(someone, "delete_money_account", { accountId: flat.id })).toEqual({
      isError: true,
      text: "Not found",
    });
  });

  test("answers a refusal as a tool error the model can act on", async () => {
    const me = await connectMcp(request, "/money/mcp", uniqueLogin());

    expect(await callTool(me, "import_hl_export", { csv: "Date,Amount\n1,2\n" })).toMatchObject({ isError: true });
    expect(await callTool(me, "sync_bank_connection", { connectionId: crypto.randomUUID() })).toEqual({
      isError: true,
      text: "Not found",
    });
  });
});
