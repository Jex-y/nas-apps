import { requestJson } from "../web";
import { THEMES, type ThemeId } from "../web/theme";
import { appSlugAt, SHELL_API, ShellApps } from "./contract";
import { element, setupPush } from "./push";
import { installApp } from "./register";
import { chooseTheme, followSavedTheme } from "./saved-theme";

/** The theme in force can change under the page: saved from another device, or picked in another tab. */
const checkAppliedTheme = () => {
  for (const input of element("themes").querySelectorAll("input")) {
    input.checked = input.value === document.documentElement.dataset.theme;
  }
};

const choose = async (theme: ThemeId) => {
  try {
    await chooseTheme(theme);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    element("theme-hint").textContent = `Changed on this device only: ${reason}`;
  }
};

const renderThemes = () => {
  const template = element<HTMLTemplateElement>("theme-option");
  element("themes").replaceChildren(
    ...THEMES.map(({ id, name, description }) => {
      const option = template.content.cloneNode(true) as DocumentFragment;
      const input = option.querySelector("input") as HTMLInputElement;
      input.value = id;
      input.addEventListener("change", () => choose(id));
      (option.querySelector(".theme-preview") as HTMLElement).dataset.theme = id;
      (option.querySelector(".theme-name") as HTMLElement).textContent = name;
      (option.querySelector(".theme-description") as HTMLElement).textContent = description;
      return option;
    }),
  );
  checkAppliedTheme();
  new MutationObserver(checkAppliedTheme).observe(document.documentElement, { attributeFilter: ["data-theme"] });
};

/** Served inside an app, the page leads back to it and offers its notifications. */
const setupApp = async (slug: string) => {
  const [apps, registration] = await Promise.all([requestJson(`${SHELL_API}/apps`, ShellApps), installApp(slug)]);
  const app = apps.find((candidate) => candidate.slug === slug);
  if (app === undefined) {
    throw new Error(`No app is served at /${slug}/`);
  }
  const back = element<HTMLAnchorElement>("back");
  back.href = `/${slug}/`;
  back.textContent = `‹ ${app.title}`;
  await setupPush(app, registration);
};

renderThemes();
const slug = appSlugAt(location.pathname);
if (slug === null) {
  followSavedTheme();
} else {
  await setupApp(slug);
}
