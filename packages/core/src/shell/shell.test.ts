import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createECDH, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import webpush from "web-push";
import { createNotifierFactory, parseNotifyConfig } from "../notify";
import { subscriptions } from "../push/schema";
import { createWebPushNotifier, type WebPushConfig } from "../push/send";
import { startServer } from "../server";
import { createTestContext, uniqueLogin } from "../testing";

const context = createTestContext();
const db = drizzle({ client: context.sql });
const vapid = webpush.generateVAPIDKeys();
const webPush: WebPushConfig = { ...vapid, subject: "mailto:apps@example.com" };

const server = startServer({
  port: 0,
  development: false,
  apps: [],
  shell: { identity: context.identity, sql: context.sql, webPush },
});
afterAll(() => server.stop(true));

const request = (path: string, init: RequestInit & { as?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.as !== undefined) {
    headers.set("Tailscale-User-Login", init.as);
  }
  return fetch(new URL(path, server.url), { ...init, headers });
};

/** A subscription a real browser could have produced: a P-256 public key and a 16-byte auth secret. */
const browserSubscription = (endpoint = `https://push.example/${crypto.randomUUID()}`) => {
  const keys = createECDH("prime256v1");
  keys.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: keys.getPublicKey("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
};

const subscribe = (as: string, subscription = browserSubscription()) =>
  request("/shell/api/push/subscriptions", {
    method: "POST",
    as,
    body: JSON.stringify(subscription),
  });

beforeEach(async () => {
  await db.delete(subscriptions);
});

describe("notify config", () => {
  test("requires a complete VAPID key pair and a contact subject", () => {
    expect(
      parseNotifyConfig({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@b.c" }),
    ).toEqual({ publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.c" });
    expect(() => parseNotifyConfig({ VAPID_PUBLIC_KEY: "pub" })).toThrow(/VAPID_PRIVATE_KEY/);
    expect(() =>
      parseNotifyConfig({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "someone" }),
    ).toThrow(/VAPID_SUBJECT/);
  });
});

describe("shell", () => {
  test("serves an installable manifest scoped to every app", async () => {
    const response = await request("/manifest.webmanifest");
    expect(response.headers.get("Content-Type")).toBe("application/manifest+json");
    expect(await response.json()).toMatchObject({
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
  });

  test("serves the service worker from the root, uncached, and the icons", async () => {
    const worker = await request("/sw.js");
    expect(worker.headers.get("Content-Type")).toStartWith("text/javascript");
    expect(worker.headers.get("Cache-Control")).toBe("no-cache");
    expect(await worker.text()).toContain('addEventListener("push"');
    for (const size of [180, 192, 512]) {
      const icon = await request(`/shell/icons/icon-${size}.png`);
      expect(icon.status).toBe(200);
      expect(icon.headers.get("Content-Type")).toBe("image/png");
    }
  });

  test("tells the launcher the key to subscribe with", async () => {
    expect(await (await request("/shell/api/push")).json()).toEqual({
      publicKey: vapid.publicKey,
    });
  });

  test("an app cannot take the shell's slug", () => {
    const shell = {
      identity: context.identity,
      sql: context.sql,
      webPush,
    };
    const app = {
      slug: "shell",
      title: "Shell",
      routes: {} as never,
      jobs: [],
      schedules: [],
    };
    expect(() => startServer({ port: 0, development: false, apps: [app], shell })).toThrow(/reserved/);
  });
});

describe("push subscriptions", () => {
  test("stores a subscription against the viewer, and resubscribing updates it", async () => {
    const me = uniqueLogin();
    const subscription = browserSubscription();
    expect((await subscribe(me, subscription)).status).toBe(204);
    const renewed = { ...browserSubscription(subscription.endpoint) };
    expect((await subscribe(me, renewed)).status).toBe(204);

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.endpoint, subscription.endpoint));
    expect(rows).toMatchObject([{ login: me, p256dh: renewed.keys.p256dh, auth: renewed.keys.auth }]);
  });

  test("refuses anonymous and non-HTTPS subscriptions", async () => {
    expect(
      (
        await request("/shell/api/push/subscriptions", {
          method: "POST",
          body: JSON.stringify(browserSubscription()),
        })
      ).status,
    ).toBe(401);
    expect((await subscribe(uniqueLogin(), browserSubscription("http://push.example/x"))).status).toBe(400);
  });

  test("only removes the viewer's own subscription", async () => {
    const me = uniqueLogin();
    const subscription = browserSubscription();
    await subscribe(me, subscription);
    const remove = (as: string) =>
      request("/shell/api/push/subscriptions", {
        method: "DELETE",
        as,
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });

    await remove(uniqueLogin());
    expect(await db.select().from(subscriptions)).toHaveLength(1);
    await remove(me);
    expect(await db.select().from(subscriptions)).toHaveLength(0);
  });
});

describe("web push notifier", () => {
  const recordingPushService = (statusFor: (endpoint: string) => number) => {
    const sent: { url: string; headers: Headers; body: Uint8Array }[] = [];
    const send = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: new Uint8Array(init?.body as Uint8Array),
      });
      return new Response(null, { status: statusFor(String(url)) });
    }) as typeof fetch;
    return { send, sent };
  };

  test("sends an encrypted, VAPID-signed message to every subscribed browser", async () => {
    const [mine, theirs] = [browserSubscription(), browserSubscription()];
    await subscribe(uniqueLogin(), mine);
    await subscribe(uniqueLogin(), theirs);
    const service = recordingPushService(() => 201);

    await createWebPushNotifier({
      config: webPush,
      sql: context.sql,
      topic: "flats",
      send: service.send,
    }).send({
      title: "New flat",
      message: "2 bed, Hackney",
      priority: "high",
    });

    expect(service.sent.map((request) => request.url).sort()).toEqual([mine.endpoint, theirs.endpoint].sort());
    for (const request of service.sent) {
      expect(request.headers.get("Content-Encoding")).toBe("aes128gcm");
      expect(request.headers.get("Authorization")).toStartWith("vapid t=");
      expect(request.headers.get("Urgency")).toBe("high");
      expect(request.body.byteLength).toBeGreaterThan(0);
    }
  });

  test("targets one person's browsers when given a login", async () => {
    const me = uniqueLogin();
    const mine = browserSubscription();
    await subscribe(me, mine);
    await subscribe(uniqueLogin());
    const service = recordingPushService(() => 201);

    await createWebPushNotifier({
      config: webPush,
      sql: context.sql,
      topic: "shell",
      login: me,
      send: service.send,
    }).send({
      title: "Test",
      message: "Hello",
    });

    expect(service.sent.map((request) => request.url)).toEqual([mine.endpoint]);
  });

  test("an app's notifier reaches only one person's browsers when given their login", async () => {
    const received: string[] = [];
    const pushService = Bun.serve({
      port: 0,
      fetch: (request) => {
        received.push(new URL(request.url).pathname);
        return new Response(null, { status: 201 });
      },
    });
    afterAll(() => pushService.stop(true));
    const me = uniqueLogin();
    const subscribeAt = (login: string, path: string) => {
      const { endpoint, keys } = browserSubscription(new URL(path, pushService.url).href);
      return db.insert(subscriptions).values({ endpoint, ...keys, login });
    };
    await subscribeAt(me, "/mine");
    await subscribeAt(uniqueLogin(), "/theirs");
    const notifier = createNotifierFactory(webPush, context.sql);

    await notifier("pet", me).send({ title: "Pip", message: "3,200 steps to go" });
    expect(received).toEqual(["/mine"]);

    await notifier("flats").send({ title: "New flat", message: "2 bed, Hackney" });
    expect(received.toSorted()).toEqual(["/mine", "/mine", "/theirs"]);
  });

  test("forgets browsers the push service reports gone, and fails after trying the rest", async () => {
    const [gone, broken, fine] = [browserSubscription(), browserSubscription(), browserSubscription()];
    for (const subscription of [gone, broken, fine]) {
      await subscribe(uniqueLogin(), subscription);
    }
    const service = recordingPushService((url) => (url === gone.endpoint ? 410 : url === broken.endpoint ? 500 : 201));

    const sending = createWebPushNotifier({
      config: webPush,
      sql: context.sql,
      topic: "flats",
      send: service.send,
    }).send({
      title: "New flat",
      message: "2 bed, Hackney",
    });

    expect(sending).rejects.toThrow("1 of 3 push deliveries failed");
    await sending.catch(() => undefined);
    expect(service.sent).toHaveLength(3);
    expect((await db.select().from(subscriptions)).map((row) => row.endpoint).sort()).toEqual(
      [broken.endpoint, fine.endpoint].sort(),
    );
  });
});
