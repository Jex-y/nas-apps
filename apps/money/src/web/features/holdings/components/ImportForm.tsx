import { type FormEvent, useRef, useState } from "react";
import type { AccountList, ImportResult } from "../../../../contract";
import { useImportHl } from "../api/holdings";
import { decodeExport } from "../utils/decode";

const describe = (result: ImportResult, accountName: string): string =>
  result.kind === "holdings"
    ? `${accountName} now holds ${result.holdings} ${result.holdings === 1 ? "investment" : "investments"}.`
    : `Added ${result.added} ${result.added === 1 ? "transaction" : "transactions"} to ${accountName}.`;

/** Takes a Hargreaves Lansdown CSV export. Only a transaction history has to be told which account it is for. */
export const ImportForm = ({ accounts }: { accounts: AccountList }) => {
  const importHl = useImportHl();
  const file = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState("");
  const targets = accounts.filter((account) => account.feed.kind !== "bank");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const chosen = file.current?.files?.[0];
    if (chosen !== undefined) {
      const csv = decodeExport(await chosen.arrayBuffer());
      importHl.mutate({ csv, accountId: accountId === "" ? null : accountId });
    }
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <input ref={file} type="file" accept=".csv,text/csv" aria-label="Hargreaves Lansdown CSV export" required />
      <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Account">
        <option value="">The account the file names</option>
        {targets.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
      <button type="submit" disabled={importHl.isPending}>
        {importHl.isPending ? "Importing…" : "Import"}
      </button>
      {importHl.error && <span className="error">{importHl.error.message}</span>}
      {importHl.data && (
        <span className="muted" role="status">
          {describe(
            importHl.data,
            accounts.find((account) => account.id === importHl.data.accountId)?.name ?? "The account",
          )}
        </span>
      )}
    </form>
  );
};
