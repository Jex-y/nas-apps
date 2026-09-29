import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { artworkSvg, fixedPalette, markFor, type Oklch } from "./artwork";

/**
 * The Home Screen icon: the launcher's badge seeded with the shell's reserved slug, in the dark theme's colours.
 * Imported as a Bun macro, so it is rasterised while bundling and the PNGs are inlined into the server.
 */

const ICON_SIZES = [180, 192, 512] as const;
type IconSize = (typeof ICON_SIZES)[number];

/** A fold no launcher tile takes until the fifth app, so the icon does not read as one of them. */
const ICON_MARK = markFor("shell", { hue: 185, fold: 8 });

/** OKLab to linear sRGB (Björn Ottosson), clipped to gamut and gamma-encoded. */
const toHex = ({ l, c, h }: Oklch) => {
  const [a, b] = [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
  const [lms1, lms2, lms3] = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  const linear = [
    4.0767416621 * lms1 - 3.3077115913 * lms2 + 0.2309699292 * lms3,
    -1.2684380046 * lms1 + 2.6097574011 * lms2 - 0.3413193965 * lms3,
    -0.0041960863 * lms1 - 0.7034186147 * lms2 + 1.707614701 * lms3,
  ];
  const encode = (channel: number) => {
    const clipped = Math.min(1, Math.max(0, channel));
    const gamma = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(gamma * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${linear.map(encode).join("")}`;
};

/** Base64 PNGs by size; a macro can only return plain data. */
export const renderIcons = async (): Promise<Record<IconSize, string>> => {
  await initWasm(Bun.file(Bun.resolveSync("@resvg/resvg-wasm/index_bg.wasm", import.meta.dir)).arrayBuffer());
  // resvg reads no oklch(). Maskable icons are cropped to a circle of 80% of the width, so the badge stays inside it.
  const svg = artworkSvg(ICON_MARK, {
    width: 200,
    height: 200,
    scale: 0.78,
    palette: fixedPalette(ICON_MARK.hue, "dark", toHex),
  });
  const render = (size: IconSize) =>
    Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng()).toString("base64");
  return Object.fromEntries(ICON_SIZES.map((size) => [size, render(size)])) as Record<IconSize, string>;
};
