import { HttpError } from "@apps/core";
import { eq } from "drizzle-orm";
import {
  type Activity,
  type ConnectOutcome,
  MAX_MAP_SPAN,
  type MapStreet,
  type NearbyStreet,
  type NetworkStatus,
  type Stats,
  type StravaStatus,
  type StreetNode,
  type Suggestion,
  type UploadResult,
} from "../contract";
import type { StreetsDb } from "./db";
import { type Box, contains, type LatLon, LONDON } from "./geo";
import type { OAuthStates } from "./oauth-state";
import { connections } from "./schema";
import type { StravaApi } from "./strava";
import { GpxError, parseGpx } from "./track";
import {
  readActivities,
  readMap,
  readNetworkStatus,
  readStats,
  readStravaStatus,
  readStreetNodes,
  readStreetsNear,
  readSuggestions,
} from "./views";
import type { StreetsWork } from "./work";

export type StreetsServiceDeps = {
  readonly db: StreetsDb;
  readonly work: StreetsWork;
  /** `null` when no Strava application is configured; only uploaded GPX files are imported then. */
  readonly strava: StravaApi | null;
  readonly states: OAuthStates;
  readonly publicUrl: string;
  readonly now: () => Date;
};

/** What Strava sent back to the callback: the athlete either refused, or granted a code for some scopes. */
export type StravaAnswer =
  | { readonly kind: "denied" }
  | { readonly kind: "granted"; readonly code: string; readonly scopes: readonly string[] };

export type GpxUpload = {
  readonly filename: string;
  /** The file as uploaded, gzipped or not. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** Dates a file whose points carry no times; `null` when the upload did not say. */
  readonly modifiedAt: Date | null;
};

type UploadOutcome =
  | { readonly kind: "imported" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "failed"; readonly filename: string; readonly error: string };

const READ_SCOPES = ["activity:read", "activity:read_all"];
/** The most streets a nearby search covers; about a kilometre and a half either side. */
export const MAX_NEARBY_METRES = 1_500;

const isGzip = (bytes: Uint8Array) => bytes[0] === 0x1f && bytes[1] === 0x8b;

/**
 * Everything a person does with their streets, shared by the HTTP API and the MCP server. Each fails with an
 * {@link HttpError} saying why it was refused. Progress, runs and the Strava connection are the login's own; the
 * street network is shared by everyone.
 */
export const createStreetsService = ({ db, work, strava, states, publicUrl, now }: StreetsServiceDeps) => {
  const requireStrava = (): StravaApi => {
    if (strava === null) {
      throw new HttpError(503, "Strava is not configured on this server");
    }
    return strava;
  };

  const requireLondon = (point: LatLon) => {
    if (!contains(LONDON, point)) {
      throw new HttpError(400, "That is outside London, where no streets are tracked");
    }
  };

  const redirectUri = `${publicUrl}/streets/api/strava/callback`;

  const stravaStatus = (login: string): Promise<StravaStatus> => readStravaStatus(db, login, strava !== null);

  const restartBackfill = async (login: string) => {
    const [restarted] = await db
      .update(connections)
      .set({ backfill: "running", backfillFinishedAt: null })
      .where(eq(connections.login, login))
      .returning({ login: connections.login });
    if (restarted === undefined) {
      throw new HttpError(404, "Strava is not connected");
    }
    await work.startBackfill(login);
  };

  const importUpload = async (login: string, { filename, bytes, modifiedAt }: GpxUpload): Promise<UploadOutcome> => {
    const xml = new TextDecoder().decode(isGzip(bytes) ? Bun.gunzipSync(bytes) : bytes);
    try {
      const gpx = parseGpx(xml, {
        name: filename.replace(/\.gpx(\.gz)?$/i, "") || "Uploaded run",
        startAt: modifiedAt ?? now(),
      });
      const imported = await work.importGpx(login, gpx, new Bun.CryptoHasher("sha256").update(xml).digest("hex"));
      return { kind: imported ? "imported" : "duplicate" };
    } catch (error) {
      if (!(error instanceof GpxError)) {
        throw error;
      }
      return { kind: "failed", filename, error: error.message };
    }
  };

  return {
    stravaStatus,

    /** Where to send the browser to authorise this login with Strava. */
    authorizeUrl: (login: string): string => requireStrava().authorizeUrl(redirectUri, states.issue(login, now())),

    /** Stores the connection Strava granted and starts importing the athlete's history. */
    finishConnecting: async (login: string, state: string, answer: StravaAnswer): Promise<ConnectOutcome> => {
      const api = requireStrava();
      if (!states.verify(state, login, now())) {
        throw new HttpError(400, "This Strava authorisation expired or was not started here; connect again");
      }
      if (answer.kind === "denied") {
        return "denied";
      }
      if (!answer.scopes.some((scope) => READ_SCOPES.includes(scope))) {
        return "scope";
      }
      const grant = await api.exchangeCode(answer.code);
      const [taken] = await db
        .select({ login: connections.login })
        .from(connections)
        .where(eq(connections.athleteId, grant.athlete.id));
      if (taken !== undefined && taken.login !== login) {
        throw new HttpError(409, "That Strava account is already connected to another login");
      }
      const connection = {
        athleteId: grant.athlete.id,
        athleteName: grant.athlete.name,
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken,
        expiresAt: grant.expiresAt,
        scope: answer.scopes.join(","),
        backfill: "running" as const,
        backfillFinishedAt: null,
        lastError: null,
      };
      await db
        .insert(connections)
        .values({ login, ...connection })
        .onConflictDoUpdate({ target: connections.login, set: connection });
      await work.startBackfill(login);
      return "connected";
    },

    /** Walks and hikes only count once asked for; turning them on re-reads the history to find them. */
    setIncludeWalks: async (login: string, includeWalks: boolean): Promise<StravaStatus> => {
      const [updated] = await db
        .update(connections)
        .set({ includeWalks })
        .where(eq(connections.login, login))
        .returning({ login: connections.login });
      if (updated === undefined) {
        throw new HttpError(404, "Strava is not connected");
      }
      if (includeWalks) {
        await restartBackfill(login);
      }
      return stravaStatus(login);
    },

    /** Forgets the connection and revokes it at Strava; runs already imported, and their streets, are kept. */
    disconnect: async (login: string): Promise<void> => {
      const [removed] = await db.delete(connections).where(eq(connections.login, login)).returning();
      if (removed === undefined) {
        throw new HttpError(404, "Strava is not connected");
      }
      await strava?.deauthorize(removed.accessToken).catch((error: unknown) => {
        console.error("Strava deauthorisation failed", error);
      });
    },

    restartBackfill,

    importGpx: async (login: string, uploads: readonly GpxUpload[]): Promise<UploadResult> => {
      const outcomes: UploadOutcome[] = [];
      for (const upload of uploads) {
        outcomes.push(await importUpload(login, upload));
      }
      return {
        imported: outcomes.filter((outcome) => outcome.kind === "imported").length,
        duplicates: outcomes.filter((outcome) => outcome.kind === "duplicate").length,
        failed: outcomes.flatMap((outcome) =>
          outcome.kind === "failed" ? [{ filename: outcome.filename, error: outcome.error }] : [],
        ),
      };
    },

    map: async (login: string, box: Box): Promise<MapStreet[]> => {
      if (box.north - box.south > MAX_MAP_SPAN.lat || box.east - box.west > MAX_MAP_SPAN.lon) {
        throw new HttpError(400, "Zoom in to see streets");
      }
      return readMap(db, login, box);
    },

    stats: (login: string): Promise<Stats> => readStats(db, login, now()),

    suggestions: async (login: string, start: LatLon): Promise<Suggestion[]> => {
      requireLondon(start);
      return readSuggestions(db, login, start);
    },

    streetsNear: async (login: string, centre: LatLon, radiusMetres: number): Promise<NearbyStreet[]> => {
      requireLondon(centre);
      return readStreetsNear(db, login, centre, Math.min(radiusMetres, MAX_NEARBY_METRES));
    },

    activities: (login: string, limit: number): Promise<Activity[]> => readActivities(db, login, limit),

    /** Clears the login's progress and matches every run again. */
    rematch: async (login: string): Promise<void> => {
      await work.rematchAll(login);
    },

    networkStatus: (): Promise<NetworkStatus> => readNetworkStatus(db),

    /** Imports the street network from OpenStreetMap now, however recent the last import. */
    refreshNetwork: async (): Promise<void> => {
      await work.refreshNetwork();
    },

    streetNodes: (login: string, streetId: number): Promise<StreetNode[]> => readStreetNodes(db, login, streetId),
  };
};

export type StreetsService = ReturnType<typeof createStreetsService>;
