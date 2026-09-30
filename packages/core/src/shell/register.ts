import { followTheme } from "../web/theme";

const append = (tag: "link" | "meta", attributes: Record<string, string>) => {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  document.head.append(element);
};

/**
 * Applies the stored theme, makes any page installable as the one Home Screen app and registers the worker that
 * receives push. The head tags are added here rather than in each index.html because Bun's HTML bundler tries to
 * resolve their hrefs as files.
 */
export const installShell = async (): Promise<ServiceWorkerRegistration | null> => {
  followTheme();
  append("link", { rel: "manifest", href: "/manifest.webmanifest" });
  append("link", { rel: "apple-touch-icon", href: "/shell/icons/icon-180.png" });
  append("meta", { name: "apple-mobile-web-app-title", content: "Apps" });
  append("meta", { name: "mobile-web-app-capable", content: "yes" });
  return "serviceWorker" in navigator ? navigator.serviceWorker.register("/sw.js", { scope: "/" }) : null;
};
