// Served as-is at /sw.js, and registered by each app for its own scope, so every installed app holds its own push
// subscription. It deliberately has no fetch handler: pages always come from the network, so a deploy is never hidden
// behind a cached bundle.

// The app's root, e.g. "/flats/".
const scope = new URL(self.registration.scope).pathname;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
