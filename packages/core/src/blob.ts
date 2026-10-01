import { S3Client } from "bun";
import { z } from "zod";

export type BlobConfig = {
  /** Where the server reaches the object store. */
  readonly endpoint: string;
  /** Where browsers reach it; presigned URLs are signed for this host, so it must be the one they request. */
  readonly publicEndpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
};

const BlobEnv = z.object({
  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
});

export const parseBlobConfig = (env: Readonly<Record<string, string | undefined>>): BlobConfig => {
  const result = BlobEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  const blob = result.data;
  return {
    endpoint: blob.S3_ENDPOINT,
    publicEndpoint: blob.S3_PUBLIC_ENDPOINT,
    region: blob.S3_REGION,
    bucket: blob.S3_BUCKET,
    accessKeyId: blob.S3_ACCESS_KEY_ID,
    secretAccessKey: blob.S3_SECRET_ACCESS_KEY,
  };
};

export type BlobDownload = {
  /** Suggested filename for the browser's save dialog. */
  readonly filename: string;
  readonly expiresInSeconds?: number;
};

/** Object storage scoped to one app: every key lives under `<namespace>/` in the shared bucket. */
export type BlobStore = {
  readonly write: (key: string, data: Blob, contentType: string) => Promise<void>;
  readonly read: (key: string) => Promise<Uint8Array<ArrayBuffer>>;
  readonly delete: (key: string) => Promise<void>;
  readonly exists: (key: string) => Promise<boolean>;
  readonly downloadUrl: (key: string, download: BlobDownload) => string;
};

const client = (config: BlobConfig, endpoint: string): S3Client =>
  new S3Client({
    endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

const contentDisposition = (filename: string): string => `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;

export const createBlobStore = (config: BlobConfig, namespace: string): BlobStore => {
  const internal = client(config, config.endpoint);
  const public_ = client(config, config.publicEndpoint);
  const path = (key: string) => `${namespace}/${key}`;

  return {
    write: async (key, data, contentType) => {
      await internal.write(path(key), data, { type: contentType });
    },
    read: (key) => internal.file(path(key)).bytes(),
    delete: (key) => internal.delete(path(key)),
    exists: (key) => internal.exists(path(key)),
    downloadUrl: (key, { filename, expiresInSeconds = 300 }) =>
      public_.presign(path(key), {
        method: "GET",
        expiresIn: expiresInSeconds,
        contentDisposition: contentDisposition(filename),
      }),
  };
};
