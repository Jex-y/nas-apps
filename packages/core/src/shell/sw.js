// Served as-is at /sw.js so its scope covers every app. It deliberately has no fetch handler: pages always come from
// the network, so a deploy is never hidden behind a cached bundle.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// The payload is `PushPayload` from push/send.ts.
self.addEventListener("push", (event) => {
  const payload = event.data?.json() ?? {
    title: "Apps",
    body: "",
    url: "/",
    tag: "shell",
  };
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/shell/icons/icon-192.png",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find((client) => new URL(client.url).origin === url.origin);
      if (existing === undefined) {
        await self.clients.openWindow(url.href);
        return;
      }
      await existing.focus();
      await existing.navigate(url.href);
    })(),
  );
});
