import { saveTheme, storedTheme, THEMES } from "../web/theme";
import { ALL_PUSH_KINDS, element, setupPush } from "./push";
import { installShell } from "./register";

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

renderThemes();
await installShell().then((registration) => setupPush(registration, ALL_PUSH_KINDS));
