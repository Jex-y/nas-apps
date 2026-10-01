// Served to each app at /<slug>/shell/sw.js behind a line declaring OFFLINE, and registered for the app's own scope,
// so every installed app holds its own push subscription. Unless the app works offline it has no fetch handler: pages
// always come from the network, so a deploy is never hidden behind a cached bundle.

// The app's root, e.g. "/flats/".
const scope = new URL(self.registration.scope).pathname;

const MANIFEST = `${scope}shell/offline.json`;
const CACHE_PREFIX = `offline:${scope}:`;
const NAVIGATION_TIMEOUT_MS = 3000;

// The newest cache holding its own manifest, which is stored only once every file is in.
const precache = async () => {
  const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX));
  for (const name of names.reverse()) {
    const cache = await caches.open(name);
    if (await cache.match(MANIFEST)) {
      return cache;
    }
  }
  return null;
};

// Fetches the app's files afresh whenever the server lists a version not yet held, then drops the versions before it.
const refresh = async () => {
  const response = await fetch(MANIFEST, { cache: "no-store" });
  if (!response.ok) {
    return;
  }
  const { version, urls } = await response.clone().json();
  const name = `${CACHE_PREFIX}${version}`;
  const cache = await caches.open(name);
  if (!(await cache.match(MANIFEST))) {
    await cache.addAll(urls.map((url) => new Request(url, { cache: "reload" })));
    await cache.put(MANIFEST, response);
  }
  const stale = (await caches.keys()).filter((other) => other.startsWith(CACHE_PREFIX) && other !== name);
  await Promise.all(stale.map((other) => caches.delete(other)));
};

// The network's answer while it gives one promptly, so a deploy shows at once; the kept page when it does not.
const navigate = async (request) => {
  const page = await (await precache())?.match(scope);
  if (page === undefined) {
    return fetch(request);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    return response.status >= 500 ? page : response;
  } catch {
    return page;
  } finally {
    clearTimeout(timer);
  }
};

// The page's files are named by their content, so a kept copy is never out of date.
const asset = async (request) => (await (await precache())?.match(request)) ?? fetch(request);

self.addEventListener("install", (event) => {
  self.skipWaiting();
  if (OFFLINE) {
    event.waitUntil(refresh().catch(() => {}));
  }
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

if (OFFLINE) {
  self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin) {
      return;
    }
    // The shell's own pages inside the app, such as its settings, are not the page kept for it.
    if (request.mode === "navigate" && !url.pathname.startsWith(`${scope}shell/`)) {
      const response = navigate(request);
      event.respondWith(response);
      event.waitUntil(response.then(refresh).catch(() => {}));
    } else if (request.mode !== "navigate" && request.destination !== "") {
      // Scripts, styles and workers; what the page itself fetches, such as its API, has no destination.
      event.respondWith(asset(request));
    }
  });
}

// The payload is `PushPayload` from push/send.ts.
self.addEventListener("push", (event) => {
  const payload = event.data?.json() ?? {
    title: "New activity",
    body: "",
    url: scope,
    tag: scope,
  };
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: `${scope}shell/icons/icon-192.png`,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? scope, self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Other apps share the origin; only a window of this app is reused.
      const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
      if (existing === undefined) {
        await self.clients.openWindow(url.href);
        return;
      }
      await existing.focus();
      await existing.navigate(url.href);
    })(),
  );
});
