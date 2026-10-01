import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { artworkSvg, fixedPalette, type Mark, type Oklch } from "./artwork";
import { resvgWasm } from "./resvg-wasm" with { type: "macro" };

/** An app's Home Screen icon: its launcher badge in the dark theme's colours. */

export const ICON_SIZES = [180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

/** PNG bytes by size. */
export type Icons = Readonly<Record<IconSize, Uint8Array<ArrayBuffer>>>;

const RESVG_WASM = await resvgWasm();

/** `initWasm` throws when called twice, so every render awaits the one call. */
let resvg: Promise<void> | undefined;

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

export const renderIcons = async (mark: Mark): Promise<Icons> => {
  resvg ??= initWasm(Bun.gunzipSync(Buffer.from(RESVG_WASM, "base64")));
  await resvg;
  // resvg reads no oklch(). Maskable icons are cropped to a circle of 80% of the width, so the badge stays inside it.
  const svg = artworkSvg(mark, {
    width: 200,
    height: 200,
    scale: 0.78,
    palette: fixedPalette(mark.hue, "dark", toHex),
  });
  const render = (size: IconSize) =>
    new Uint8Array(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());
  return Object.fromEntries(ICON_SIZES.map((size) => [size, render(size)])) as Icons;
};
