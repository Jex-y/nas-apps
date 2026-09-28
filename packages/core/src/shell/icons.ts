import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { artworkSvg } from "./artwork";

/**
 * The Home Screen icon: the launcher artwork seeded with the shell's reserved slug, in the dark theme's colours.
 * Imported as a Bun macro, so it is rasterised while bundling and the PNGs are inlined into the server.
 */

const ICON_SIZES = [180, 192, 512] as const;
type IconSize = (typeof ICON_SIZES)[number];

const ICON_SEED = "shell";
const ICON_BACKGROUND = "#111413";

/** Theme colours from theme.css's dark scheme; resvg has no CSS variables. */
const DARK_COLOURS = ["#1fc7b8", "#2fd083", "#ea7fd0", "#f7a1b7"];

/** Base64 PNGs by size; a macro can only return plain data. */
export const renderIcons = async (): Promise<Record<IconSize, string>> => {
  await initWasm(Bun.file(Bun.resolveSync("@resvg/resvg-wasm/index_bg.wasm", import.meta.dir)).arrayBuffer());
  // Maskable icons are cropped to a circle of 80% of the width, so keep the points inside it.
  const svg = artworkSvg(ICON_SEED, {
    width: 200,
    height: 200,
    margin: 36,
    colours: DARK_COLOURS,
    background: ICON_BACKGROUND,
  });
  const render = (size: IconSize) =>
    Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng()).toString("base64");
  return Object.fromEntries(ICON_SIZES.map((size) => [size, render(size)])) as Record<IconSize, string>;
};
