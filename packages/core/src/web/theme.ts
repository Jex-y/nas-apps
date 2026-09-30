export const THEMES = [
  { id: "glass", name: "Glass", description: "Frosted panes over soft colour, rounded and light." },
  { id: "drafting", name: "Drafting", description: "Ink rules on grid paper, square corners, a blueprint at night." },
  { id: "command", name: "Command", description: "Dark and dense, whatever your device is set to." },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "glass";

const STORAGE_KEY = "theme";

/**
 * Inlined in every page's `<head>` so a stored theme applies before first paint. A stored value no theme matches
 * leaves the default's tokens in force, since the default's are also declared on bare `:root`.
 */
export const THEME_BOOT_SCRIPT = `<script>try{document.documentElement.dataset.theme=localStorage.getItem("${STORAGE_KEY}")??"${DEFAULT_THEME}"}catch{}</script>`;

export const parseTheme = (value: string | null): ThemeId =>
  THEMES.find((theme) => theme.id === value)?.id ?? DEFAULT_THEME;

/** Storage can throw, e.g. in a locked-down private window; the default theme is then used. */
export const storedTheme = (): ThemeId => {
  try {
    return parseTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
};

/** The browser chrome takes the page ground's colour, which depends on both the theme and the system scheme. */
const syncThemeColor = () => {
  const meta =
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]') ??
    document.head.appendChild(Object.assign(document.createElement("meta"), { name: "theme-color" }));
  meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
};

export const applyTheme = (theme: ThemeId) => {
  document.documentElement.dataset.theme = theme;
  syncThemeColor();
};

export const saveTheme = (theme: ThemeId) => {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Still applied to this page, just not remembered.
  }
  applyTheme(theme);
};

/** Applies the stored theme, and follows changes to it from other tabs and to the system colour scheme. */
export const followTheme = () => {
  applyTheme(storedTheme());
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      applyTheme(parseTheme(event.newValue));
    }
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);
};
