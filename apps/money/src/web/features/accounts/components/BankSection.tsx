import { type FormEvent, useState } from "react";
import type { Connection } from "../../../../contract";
import { formatDate, formatInstant } from "../../../utils/format";
import { useBanking, useDisconnect, useInstitutions, useLinkBank, useSyncConnection } from "../api/banking";

const ConnectionRow = ({ connection }: { connection: Connection }) => {
  const sync = useSyncConnection();
  const link = useLinkBank();
  const disconnect = useDisconnect();
  const expired = new Date(connection.validUntil) <= new Date();
  const failure = sync.error ?? link.error ?? disconnect.error;

  const confirmDisconnect = () => {
    if (window.confirm(`Stop reading ${connection.institution}? Its accounts and history stay.`)) {
      disconnect.mutate(connection.id);
    }
  };

  return (
    <li className="card">
      <div className="card-heading">
        <div>
          <h3>{connection.institution}</h3>
          <p className="muted">
            {expired ? (
              <span className="badge warning">Consent ran out {formatDate(connection.validUntil)}</span>
            ) : (
              <>Consent until {formatDate(connection.validUntil)}</>
            )}
            {" · "}
            {connection.lastSyncedAt === null ? "Not read yet" : `Last read ${formatInstant(connection.lastSyncedAt)}`}
          </p>
          {connection.lastError !== null && <p className="error">The last read failed: {connection.lastError}</p>}
        </div>
        <div className="actions">
          <button type="button" onClick={() => sync.mutate(connection.id)} disabled={expired || sync.isPending}>
            {sync.isSuccess ? "Reading…" : "Read now"}
          </button>
          <button
            type="button"
            className={expired ? "primary" : undefined}
            onClick={() => link.mutate({ name: connection.institution, country: connection.country })}
            disabled={link.isPending}
          >
            Renew
          </button>
          <button type="button" className="danger" onClick={confirmDisconnect} disabled={disconnect.isPending}>
            Disconnect
          </button>
        </div>
      </div>
      {failure && <p className="error">{failure.message}</p>}
    </li>
  );
};

const LinkBankForm = () => {
  const institutions = useInstitutions(true);
  const link = useLinkBank();
  const [search, setSearch] = useState("HSBC");
  const [chosen, setChosen] = useState("");
  const matches = (institutions.data ?? []).filter((institution) =>
    institution.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const institution = matches.find((other) => other.name === chosen) ?? matches[0];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (institution !== undefined) {
      link.mutate(institution);
    }
  };

  if (institutions.error) {
    return <p className="error">{institutions.error.message}</p>;
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search banks"
        aria-label="Search banks"
      />
      <select
        value={institution?.name ?? ""}
        onChange={(event) => setChosen(event.target.value)}
        aria-label="Bank"
        disabled={matches.length === 0}
      >
        {matches.length === 0 && <option value="">{institutions.isPending ? "Loading…" : "No bank matches"}</option>}
        {matches.map((option) => (
          <option key={option.name} value={option.name}>
            {option.name}
          </option>
        ))}
      </select>
      <button type="submit" disabled={institution === undefined || link.isPending}>
        Log in at the bank
      </button>
      {link.error && <span className="error">{link.error.message}</span>}
    </form>
  );
};

export const BankSection = () => {
  const banking = useBanking();
  const [linking, setLinking] = useState(false);

  if (banking.isPending) {
    return null;
  }
  if (banking.error) {
    return <p className="error">{banking.error.message}</p>;
  }
  return (
    <section>
      <h2>Banks</h2>
      {!banking.data.available && (
        <p className="muted">
          Linking a bank needs an Enable Banking application: set <code>ENABLE_BANKING_APP_ID</code> and{" "}
          <code>ENABLE_BANKING_PRIVATE_KEY</code> on the server.
        </p>
      )}
      <ul className="cards">
        {banking.data.connections.map((connection) => (
          <ConnectionRow key={connection.id} connection={connection} />
        ))}
      </ul>
      {banking.data.available &&
        (linking ? (
          <LinkBankForm />
        ) : (
          <button type="button" onClick={() => setLinking(true)}>
            Link a bank
          </button>
        ))}
    </section>
  );
};
