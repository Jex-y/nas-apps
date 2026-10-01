import { requestEmpty, requestJson } from "../web";
import { followTheme, saveTheme, storedTheme, type ThemeId } from "../web/theme";
import { SavedTheme, SHELL_API, type ThemeChoice } from "./contract";

const THEME_API = `${SHELL_API}/theme`;

/** The viewer's saved theme wins over this browser's copy, which is then brought in line for the next first paint. */
const adoptSavedTheme = async () => {
  const { theme } = await requestJson(THEME_API, SavedTheme);
  if (theme !== null && theme !== storedTheme()) {
    saveTheme(theme);
  }
};

/** {@link followTheme}, then the theme the viewer saved from any other browser or installed app. */
export const followSavedTheme = () => {
  followTheme();
  // Offline or signed out, this browser's copy stands.
  adoptSavedTheme().catch(() => undefined);
};

/** Applies the theme here at once, then saves it for the viewer's other browsers and installed apps. */
export const chooseTheme = async (theme: ThemeId) => {
  saveTheme(theme);
  await requestEmpty(THEME_API, { method: "PUT", body: JSON.stringify({ theme } satisfies ThemeChoice) });
};
