import { useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useState } from "react";
import { useSearch } from "wouter";
import {
  COMPLETION_PERCENT,
  MATCH_RADIUS_METRES,
  NODE_SPACING_METRES,
  STREETS_API,
  type StravaStatus,
} from "../../../../contract";
import { formatCount, formatDateTime } from "../../../utils/format";
import {
  uploadGpx,
  useDisconnectStrava,
  useNetworkStatus,
  useRefreshNetwork,
  useRescan,
  useStravaStatus,
  useUpdateStrava,
} from "../api/connect";

const RESULTS: Readonly<Record<string, { readonly message: string; readonly error: boolean }>> = {
  connected: { message: "Connected. Your history is being imported.", error: false },
  denied: { message: "Strava access was not granted.", error: true },
  scope: { message: "Allow access to your activities, or there is nothing to import.", error: true },
};

const Setup = () => (
  <>
    <p className="muted">Strava is not configured on this server yet. Once, on its host:</p>
    <ol className="steps">
      <li>
        Create an API application at{" "}
        <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer">
          strava.com/settings/api
        </a>{" "}
        with Authorization Callback Domain <code>{window.location.hostname}</code>.
      </li>
      <li>
        Add its <code>STRAVA_CLIENT_ID</code> and <code>STRAVA_CLIENT_SECRET</code> to the stack's <code>.env</code>.
      </li>
      <li>Deploy, then come back here to connect.</li>
    </ol>
  </>
);

const Connection = ({ status }: { status: StravaStatus }) => {
  const update = useUpdateStrava();
  const disconnect = useDisconnectStrava();
  const rescan = useRescan();
  const connection = status.connection;
  if (connection === null) {
    return (
      <>
        <p className="muted">
          Runs are imported from your whole history, then checked for new ones every half hour during the day.
        </p>
        <a className="button primary" href={`${STREETS_API}/strava/connect`}>
          Connect with Strava
        </a>
      </>
    );
  }

  return (
    <>
      <p>
        Connected as <strong>{connection.athleteName}</strong>.
      </p>
      <dl className="facts">
        <div className="fact">
          <dt>History</dt>
          <dd>
            {connection.backfill === "running"
              ? "Importing…"
              : `Imported ${connection.backfillFinishedAt ? formatDateTime(connection.backfillFinishedAt) : ""}`}
          </dd>
        </div>
        <div className="fact">
          <dt>Runs</dt>
          <dd className="numeric">
            {formatCount(status.activities.matched)} matched
            {status.activities.pending > 0 && ` · ${formatCount(status.activities.pending)} to go`}
          </dd>
        </div>
        <div className="fact">
          <dt>Last checked</dt>
          <dd>{connection.lastPolledAt ? formatDateTime(connection.lastPolledAt) : "Not yet"}</dd>
        </div>
      </dl>
      {connection.lastError && <p className="error">{connection.lastError}</p>}
      <label className="toggle">
        <input
          type="checkbox"
          checked={connection.includeWalks}
          disabled={update.isPending}
          onChange={(event) => update.mutate({ includeWalks: event.target.checked })}
        />{" "}
        Count walks and hikes too
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={connection.includeRides}
          disabled={update.isPending}
          onChange={(event) => update.mutate({ includeRides: event.target.checked })}
        />{" "}
        Count bike rides too
      </label>
      <div className="card-actions">
        <button type="button" onClick={() => rescan.mutate()} disabled={rescan.isPending}>
          Re-scan history
        </button>
        <button type="button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
          Disconnect
        </button>
      </div>
    </>
  );
};

const Uploads = () => {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);
  const [failures, setFailures] = useState<readonly string[]>([]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    const totals = { imported: 0, duplicates: 0 };
    const failed: string[] = [];
    for (const [index, file] of files.entries()) {
      setProgress(`Uploading ${index + 1} of ${files.length}…`);
      try {
        const result = await uploadGpx(file);
        totals.imported += result.imported;
        totals.duplicates += result.duplicates;
        failed.push(...result.failed.map((failure) => `${failure.filename}: ${failure.error}`));
      } catch (error) {
        failed.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    setProgress(`${totals.imported} imported, ${totals.duplicates} already here.`);
    setFailures(failed);
    await queryClient.invalidateQueries();
  };

  return (
    <>
      <p className="muted">
        For runs not on Strava, or Strava's bulk export (Settings → My Account → Download or delete your account):
        select the <code>.gpx</code> and <code>.gpx.gz</code> files in its <code>activities</code> folder.
      </p>
      <label className="button">
        Choose GPX files
        <input type="file" accept=".gpx,.gz" multiple hidden onChange={(event) => void upload(event)} />
      </label>
      {progress && <p className="muted">{progress}</p>}
      {failures.length > 0 && (
        <ul className="error">
          {failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      )}
    </>
  );
};

const StreetData = () => {
  const network = useNetworkStatus();
  const refresh = useRefreshNetwork();
  const latest = network.data?.refresh ?? null;

  return (
    <>
      {network.data && (
        <p className="muted">
          {formatCount(network.data.streets)} streets and {formatCount(network.data.nodes)} nodes in{" "}
          {network.data.boroughs} {network.data.boroughs === 1 ? "borough" : "boroughs"}.{" "}
          {latest === null
            ? "Not imported yet."
            : latest.finishedAt === null
              ? `Importing: ${latest.tilesDone} of ${latest.tiles || "?"} tiles.`
              : `Imported ${formatDateTime(latest.finishedAt)}; refreshed monthly.`}
        </p>
      )}
      <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
        Refresh from OpenStreetMap
      </button>
    </>
  );
};

export const ConnectPage = () => {
  const strava = useStravaStatus();
  const result = RESULTS[new URLSearchParams(useSearch()).get("strava") ?? ""];

  return (
    <section className="connect">
      <h1>Connect</h1>
      {result && <p className={result.error ? "error" : "notice"}>{result.message}</p>}

      <h2>Strava</h2>
      {strava.error && <p className="error">{strava.error.message}</p>}
      {strava.data && (strava.data.configured ? <Connection status={strava.data} /> : <Setup />)}

      <h2>GPX files</h2>
      <Uploads />

      <h2>London's streets</h2>
      <StreetData />

      <h2>Rules</h2>
      <p className="muted">
        As on CityStrides: every named, runnable street in each borough, from OpenStreetMap. A node counts once a run
        passes within {MATCH_RADIUS_METRES} m of it, and a street is done at {COMPLETION_PERCENT}% of its nodes (all of
        them for streets under ten). Nodes are added every {NODE_SPACING_METRES} m along long, straight stretches, so
        crossing the ends is not enough.
      </p>
    </section>
  );
};
