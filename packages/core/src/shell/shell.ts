import { requestEmpty, requestJson } from "../web";
import { PushSettings, SHELL_API, ShellApps } from "./contract";
import { installShell } from "./register";

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`#${id} missing from index.html`);
  }
  return found as T;
};

/** mulberry32 seeded by FNV-1a, so each app keeps the same artwork across visits. */
const seededRandom = (seed: string) => {
  let state = 2166136261;
  for (const char of seed) {
    state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const PALETTE = ["var(--accent)", "var(--accent-2)", "var(--warning-fg)", "var(--fg)", "var(--border)"];
const COLUMNS = 4;
const ROWS = 2;

/** Unit-cell shapes drawn in a 10×10 cell; each is rotated by a random quarter turn. */
const SQUARE = "M0 0H10V10H0Z";
const SHAPES = [
  SQUARE,
  "M0 0H10A10 10 0 0 1 0 10Z",
  "M0 10A10 10 0 0 1 10 0V10Z",
  "M0 0H10L0 10Z",
  "M0 5A5 5 0 0 1 10 5A5 5 0 0 1 0 5Z",
  "M0 5A5 5 0 0 1 10 5Z",
];

const SVG_NS = "http://www.w3.org/2000/svg";

const path = (d: string, fill: string) => {
  const created = document.createElementNS(SVG_NS, "path");
  created.setAttribute("d", d);
  created.setAttribute("fill", fill);
  return created;
};

/** A Bauhaus-style grid of coloured shapes, drawn with theme colours so it follows light and dark mode. */
const artwork = (seed: string): SVGSVGElement => {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${COLUMNS * 10} ${ROWS * 10}`);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("art");
  for (let cell = 0; cell < COLUMNS * ROWS; cell++) {
    const background = pick(PALETTE);
    const foreground = pick(PALETTE.filter((colour) => colour !== background));
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute(
      "transform",
      `translate(${(cell % COLUMNS) * 10} ${Math.floor(cell / COLUMNS) * 10}) rotate(${pick([0, 90, 180, 270])} 5 5)`,
    );
    group.append(path(SQUARE, background), path(pick(SHAPES), foreground));
    svg.append(group);
  }
  return svg;
};

const renderApps = async () => {
  const apps = await requestJson(`${SHELL_API}/apps`, ShellApps);
  element("apps").replaceChildren(
    ...apps.map(({ slug, title }) => {
      const name = document.createElement("span");
      name.className = "app-title";
      name.textContent = title;
      const link = document.createElement("a");
      link.className = "card";
      link.href = `/${slug}/`;
      link.append(artwork(slug), name);
      const item = document.createElement("li");
      item.append(link);
      return item;
    }),
  );
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

const VIEWS: Record<PushView["kind"], { readonly status: string; readonly buttons: readonly string[] }> = {
  install: {
    status: "Add this page to your Home Screen (Share → Add to Home Screen), then open it from there.",
    buttons: [],
  },
  unsupported: {
    status: "This browser cannot receive push notifications.",
    buttons: [],
  },
  blocked: {
    status: "Notifications are blocked. Allow them for this app in Settings.",
    buttons: [],
  },
  off: {
    status: "Get notified here when your apps have news, e.g. a new flat.",
    buttons: ["push-enable"],
  },
  on: {
    status: "Notifications are on for this device.",
    buttons: ["push-test", "push-disable"],
  },
};

const setupPush = async (registration: ServiceWorkerRegistration | null) => {
  const settings = await requestJson(`${SHELL_API}/push`, PushSettings);
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
    element("push-status").textContent = VIEWS[view.kind].status;
    for (const id of ["push-enable", "push-test", "push-disable"]) {
      element(id).hidden = !VIEWS[view.kind].buttons.includes(id);
    }
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
      await requestEmpty(`${SHELL_API}/push/subscriptions`, {
        method: "POST",
        body: JSON.stringify(subscription.toJSON()),
      });
    }),
  );
  element("push-test").addEventListener(
    "click",
    run(() => requestEmpty(`${SHELL_API}/push/test`, { method: "POST" })),
  );
  element("push-disable").addEventListener(
    "click",
    run(async () => {
      const view = await currentView();
      if (view.kind !== "on") {
        return;
      }
      await requestEmpty(`${SHELL_API}/push/subscriptions`, {
        method: "DELETE",
        body: JSON.stringify({ endpoint: view.subscription.endpoint }),
      });
      await view.subscription.unsubscribe();
    }),
  );

  const view = await render();
  if (view.kind === "on") {
    // Re-register on every visit: it recovers a subscription the server dropped, e.g. after a restore.
    await requestEmpty(`${SHELL_API}/push/subscriptions`, {
      method: "POST",
      body: JSON.stringify(view.subscription.toJSON()),
    });
  }
};

await Promise.all([renderApps(), installShell().then(setupPush)]);
