import { requestEmpty, requestJson } from "../web";
import { appShellPath, PushSettings, type ShellApp } from "./contract";

export const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`#${id} missing from the page`);
  }
  return found as T;
};

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

/** iOS only offers push to a web app opened from the Home Screen. */
const needsInstall = () =>
  /iPhone|iPad/.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches;

type PushView =
  | { readonly kind: "install" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "blocked" }
  | { readonly kind: "off" }
  | { readonly kind: "on"; readonly subscription: PushSubscription };

type ViewText = { readonly status: string; readonly buttons: readonly string[] };

const viewsFor = (title: string): Record<PushView["kind"], ViewText> => ({
  install: {
    status: `Add ${title} to your Home Screen (Share → Add to Home Screen), then open it from there.`,
    buttons: [],
  },
  unsupported: {
    status: "This browser cannot receive push notifications.",
    buttons: [],
  },
  blocked: {
    status: `Notifications are blocked. Allow them for ${title} in your device's settings.`,
    buttons: [],
  },
  off: {
    status: `Get notified on this device when ${title} has news.`,
    buttons: ["push-enable"],
  },
  on: {
    status: `Notifications from ${title} are on for this device.`,
    buttons: ["push-test", "push-disable"],
  },
});

/** Drives the page's `#push` card for one app's notifications; `registration` is the worker scoped to that app. */
export const setupPush = async ({ slug, title }: ShellApp, registration: ServiceWorkerRegistration | null) => {
  const api = `${appShellPath(slug)}/api/push`;
  const views = viewsFor(title);
  const settings = await requestJson(api, PushSettings);
  const currentView = async (): Promise<PushView> => {
    if (needsInstall()) {
      return { kind: "install" };
    }
    if (registration === null || !("PushManager" in window)) {
      return { kind: "unsupported" };
    }
    if (Notification.permission === "denied") {
      return { kind: "blocked" };
    }
    const subscription = await registration.pushManager.getSubscription();
    return subscription === null ? { kind: "off" } : { kind: "on", subscription };
  };

  const render = async () => {
    const view = await currentView();
    element("push-status").textContent = views[view.kind].status;
    for (const id of ["push-enable", "push-test", "push-disable"]) {
      element(id).hidden = !views[view.kind].buttons.includes(id);
    }
    element("push").hidden = false;
    return view;
  };

  const run = (action: () => Promise<void>) => async () => {
    try {
      await action();
    } catch (error) {
      element("push-status").textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    await render();
  };

  element("push-enable").addEventListener(
    "click",
    run(async () => {
      if (registration === null || (await Notification.requestPermission()) !== "granted") {
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(settings.publicKey),
      });
      await requestEmpty(`${api}/subscriptions`, {
        method: "POST",
        body: JSON.stringify(subscription.toJSON()),
      });
    }),
  );
  element("push-test").addEventListener(
    "click",
    run(() => requestEmpty(`${api}/test`, { method: "POST" })),
  );
  element("push-disable").addEventListener(
    "click",
    run(async () => {
      const view = await currentView();
      if (view.kind !== "on") {
        return;
      }
      await requestEmpty(`${api}/subscriptions`, {
        method: "DELETE",
        body: JSON.stringify({ endpoint: view.subscription.endpoint }),
      });
      await view.subscription.unsubscribe();
    }),
  );

  const view = await render();
  if (view.kind === "on") {
    // Re-register on every visit: it recovers a subscription the server dropped, e.g. after a restore.
    await requestEmpty(`${api}/subscriptions`, {
      method: "POST",
      body: JSON.stringify(view.subscription.toJSON()),
    });
  }
};
