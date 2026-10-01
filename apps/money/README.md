# Money

Net worth over time, bank transactions broken into tagged line items, and investment holdings. Each tailnet login
keeps its own, which nobody else sees. Everything is in sterling; an account in another currency is not linked.

- **Worth**: the total, how it has moved, and every account by kind. An account counts from its first known balance.
- **Transactions**: every transaction, searchable and filtered by account or tag. Open one to tag it or break it into
  line items, which must add up to it.
- **Spending**: income, outgoings and the net per tag for each month, from cash accounts only. A line item with
  several tags counts under each.
- **Holdings**: what each investment account holds, with units, price, value and gain.
- **Accounts**: link a bank, or add anything else you own or owe (a property, a pension, a loan) and record what it
  is worth whenever that changes.

## Banks

Banks are read through [Enable Banking](https://enablebanking.com), which is free for accounts you link yourself.

1. In its [control panel](https://enablebanking.com/cp/applications), add a production application with the redirect
   URL `https://apps.<tailnet>.ts.net/money/api/bank/callback`. It downloads a private key named `<app id>.pem`.
2. Activate the application by linking your own accounts there. It can then only ever read those accounts.
3. Set `ENABLE_BANKING_APP_ID` to the app id and `ENABLE_BANKING_PRIVATE_KEY` to `base64 -i <app id>.pem`. They are
   read on start, so they take effect from the next deploy.
4. On the Accounts page, link the bank. You log in at the bank itself; no bank password ever reaches this app.

A link is read three times a day and on demand. Its first read asks for all the history the bank will give, which
most only do within an hour of logging in; past balances are then worked back from today's and the transactions
since. Only booked transactions are kept. A bank's consent lasts up to its own limit (often 90 or 180 days): a
notification goes out a week before it lapses, and Renew on the Accounts page takes you back through the bank's login.

## Hargreaves Lansdown

HL has no API for investment accounts, so they come from its CSV exports, imported on the Holdings page:

- **Holdings**: on an account's summary page, Download. Importing it replaces what that account held, and makes the
  account the first time, named as the file names it.
- **Transaction history**: adds the rows not already there to the account you choose.

Each investment is matched to its [FT Markets](https://markets.ft.com/data) listing, accepted only when FT's price
agrees with the export's, and repriced every day so the account's worth stays current between exports. Where no match
is found the holding keeps its exported price and is marked Not repriced; set its FT symbol by hand (the `s=` in its
tearsheet's address, e.g. `GB00B59G4Q73:GBP`). Securities FT does not quote in sterling cannot be repriced.

## From Claude

Every action except linking a bank is also an MCP tool at `/money/mcp`: see
[`packages/core/README.md`](../../packages/core/README.md).
