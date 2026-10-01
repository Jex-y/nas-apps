import { requestJson } from "../web";
import { followTheme } from "../web/theme";
import { artworkSvg, identityAt, markFor, themedPalette } from "./artwork";
import { SHELL_API, ShellApps } from "./contract";
import { element } from "./push";

const tileArtwork = (slug: string, index: number, count: number) => {
  const mark = markFor(slug, identityAt(index, count));
  return artworkSvg(mark, { width: 300, height: 200, scale: 0.86, palette: themedPalette(mark.hue) });
};

const renderApps = async () => {
  const apps = await requestJson(`${SHELL_API}/apps`, ShellApps);
  element("apps").replaceChildren(
    ...apps.map(({ slug, title }, index) => {
      const name = document.createElement("span");
      name.className = "app-title";
      name.textContent = title;
      const link = document.createElement("a");
      link.className = "card";
      link.href = `/${slug}/`;
      link.innerHTML = tileArtwork(slug, index, apps.length);
      link.append(name);
      const item = document.createElement("li");
      item.append(link);
      return item;
    }),
  );
};

followTheme();
await renderApps();
