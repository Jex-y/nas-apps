import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { artworkSvg, type Palette } from "./artwork";

/**
 * The Home Screen icon: the launcher artwork seeded with the shell's reserved slug, in the dark theme's colours.
 * Imported as a Bun macro, so it is rasterised while bundling and the PNGs are inlined into the server.
 */

const ICON_SIZES = [180, 192, 512] as const;
type IconSize = (typeof ICON_SIZES)[number];

const ICON_SEED = "shell";
const ICON_BACKGROUND = "#020617";

const channels = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));

/** Theme colours from theme.css's dark scheme; resvg has neither CSS variables nor `color-mix()`. */
const DARK_PALETTE: Palette = {
  colours: ["#fdba74", "#4ade80", "#38bdf8", "#a78bfa"],
  mix: (first, second, weight) => {
    const [a, b] = [channels(first), channels(second)];
    return `#${a
      .map((channel, i) =>
        Math.round(channel * weight + (b[i] ?? 0) * (1 - weight))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  },
};

/** Base64 PNGs by size; a macro can only return plain data. */
export const renderIcons = async (): Promise<Record<IconSize, string>> => {
  await initWasm(Bun.file(Bun.resolveSync("@resvg/resvg-wasm/index_bg.wasm", import.meta.dir)).arrayBuffer());
  // Maskable icons are cropped to a circle of 80% of the width, so keep the points inside it.
  const svg = artworkSvg(ICON_SEED, {
    width: 200,
    height: 200,
    margin: 36,
    palette: DARK_PALETTE,
    background: ICON_BACKGROUND,
  });
  const render = (size: IconSize) =>
    Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng()).toString("base64");
  return Object.fromEntries(ICON_SIZES.map((size) => [size, render(size)])) as Record<IconSize, string>;
};
