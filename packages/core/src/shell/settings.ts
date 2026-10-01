import { requestJson } from "../web";
import { followTheme, saveTheme, storedTheme, THEMES } from "../web/theme";
import { appSlugAt, SHELL_API, ShellApps } from "./contract";
import { element, setupPush } from "./push";
import { installApp } from "./register";

const renderThemes = () => {
  const template = element<HTMLTemplateElement>("theme-option");
  const current = storedTheme();
  element("themes").replaceChildren(
    ...THEMES.map(({ id, name, description }) => {
      const option = template.content.cloneNode(true) as DocumentFragment;
      const input = option.querySelector("input") as HTMLInputElement;
      input.value = id;
      input.checked = id === current;
      input.addEventListener("change", () => saveTheme(id));
      (option.querySelector(".theme-preview") as HTMLElement).dataset.theme = id;
      (option.querySelector(".theme-name") as HTMLElement).textContent = name;
      (option.querySelector(".theme-description") as HTMLElement).textContent = description;
      return option;
    }),
  );
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
  followTheme();
} else {
  await setupApp(slug);
}
