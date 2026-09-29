/**
 * A badge per app: a superformula body with the Maurer rose of the same fold drawn over it. The app's position picks
 * its hue and fold, so no two apps on the launcher share either; the seed picks the body and the rose's step. It
 * returns plain SVG markup so the same drawing serves the launcher (following light and dark mode) and the build-time
 * app icon (fixed colours).
 */

type Random = () => number;

type Point = readonly [x: number, y: number];

/** Folds whose rose has exactly that many petals: sin(nθ) draws n petals for odd n and 2n for even n, so 6 cannot. */
export type Fold = 3 | 4 | 5 | 7 | 8;

/** In the order apps take them, so the first few are the most distinct. */
const FOLDS: readonly Fold[] = [5, 4, 7, 3, 8];

/** Superformula exponents with n2 = n3, which keeps every lobe mirror-symmetric. */
type Body = { readonly n1: number; readonly n2: number };

const BODIES: readonly Body[] = [
  { n1: 1, n2: 1 },
  { n1: 1, n2: 3 },
  { n1: 0.5, n2: 1.5 },
  { n1: 6, n2: 12 },
];

/** Degrees per step of the Maurer walk; primes keep it from retracing a short cycle. */
const STEPS = [29, 31, 37, 43, 47, 53, 59, 61, 67, 71, 73, 79];

const FIRST_HUE = 165;

export type Identity = { readonly hue: number; readonly fold: Fold };

export type Mark = Identity & { readonly body: Body; readonly step: number };

export type Theme = "light" | "dark";

export type Oklch = { readonly l: number; readonly c: number; readonly h: number };

type Role = "tint" | "body" | "web" | "line" | "spark";

export type Palette = Readonly<Record<Role, string>>;

/** Hue offsets from the mark's hue; the spark sits near the complement. */
const ROLES: Readonly<Record<Role, Readonly<Record<Theme, Oklch>>>> = {
  tint: { light: { l: 0.97, c: 0.015, h: 0 }, dark: { l: 0.19, c: 0.03, h: 0 } },
  body: { light: { l: 0.86, c: 0.07, h: 0 }, dark: { l: 0.42, c: 0.09, h: 0 } },
  web: { light: { l: 0.7, c: 0.09, h: 0 }, dark: { l: 0.62, c: 0.1, h: 0 } },
  line: { light: { l: 0.5, c: 0.15, h: 0 }, dark: { l: 0.8, c: 0.14, h: 0 } },
  spark: { light: { l: 0.6, c: 0.16, h: 160 }, dark: { l: 0.88, c: 0.12, h: 160 } },
};

const mapRoles = (paint: (role: Role) => string): Palette =>
  Object.fromEntries((Object.keys(ROLES) as Role[]).map((role) => [role, paint(role)])) as Palette;

const themeColours = (hue: number, theme: Theme): Readonly<Record<Role, Oklch>> =>
  Object.fromEntries(
    (Object.keys(ROLES) as Role[]).map((role) => {
      const { l, c, h } = ROLES[role][theme];
      return [role, { l, c, h: (hue + h) % 360 }];
    }),
  ) as Readonly<Record<Role, Oklch>>;

const cssOklch = ({ l, c, h }: Oklch) => `oklch(${l} ${c} ${h.toFixed(1)})`;

/** Resolves against the page's `color-scheme`, so the launcher follows light and dark mode without script. */
export const themedPalette = (hue: number): Palette => {
  const [light, dark] = [themeColours(hue, "light"), themeColours(hue, "dark")];
  return mapRoles((role) => `light-dark(${cssOklch(light[role])}, ${cssOklch(dark[role])})`);
};

export const fixedPalette = (hue: number, theme: Theme, format: (colour: Oklch) => string): Palette => {
  const colours = themeColours(hue, theme);
  return mapRoles((role) => format(colours[role]));
};

/** Hues spread evenly round the wheel and folds taken in turn, so adding an app re-spaces the ones after it. */
export const identityAt = (index: number, count: number): Identity => ({
  hue: (FIRST_HUE + (index * 360) / count) % 360,
  fold: FOLDS[index % FOLDS.length] as Fold,
});

/**
 * FNV-1a mixed through murmur3's finaliser, then mulberry32 with its first draw discarded; without both, short similar
 * seeds draw alike. Changing any of it redraws every app's badge.
 */
const seededRandom = (seed: string): Random => {
  let state = 2166136261;
  for (const char of seed) {
    state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  }
  state = Math.imul(state ^ (state >>> 16), 0x85ebca6b);
  state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35);
  state ^= state >>> 16;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next();
  return next;
};

const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

export const markFor = (seed: string, identity: Identity): Mark => {
  const random = seededRandom(seed);
  return { ...identity, body: pick(random, BODIES), step: pick(random, STEPS) };
};

const TAU = 2 * Math.PI;

/** Polar to the unit square's centre, with angle 0 pointing up. */
const polar = (radius: number, angle: number): Point => [
  0.5 + radius * Math.cos(angle - Math.PI / 2),
  0.5 + radius * Math.sin(angle - Math.PI / 2),
];

const BODY_SAMPLES = 720;

/** k lobes scaled so the outermost reaches `radius`, turned so a lobe tip points up. */
const bodyOutline = (fold: Fold, { n1, n2 }: Body, radius: number): Point[] => {
  const extent = (t: number) =>
    (Math.abs(Math.cos((fold * t) / 4)) ** n2 + Math.abs(Math.sin((fold * t) / 4)) ** n2) ** (-1 / n1);
  const angles = Array.from({ length: BODY_SAMPLES }, (_, i) => (i / BODY_SAMPLES) * TAU);
  const extents = angles.map(extent);
  const largest = Math.max(...extents);
  const tip = extent(0) >= extent(Math.PI / fold) ? 0 : Math.PI / fold;
  return angles.map((t, i) => polar(((extents[i] as number) / largest) * radius, t - tip));
};

const ROSE_SAMPLES = 1440;

type Rose = { readonly curve: Point[]; readonly walk: Point[] };

/** r = sin(nθ) with `fold` petals, one pointing up, and its Maurer walk: the rose sampled every `step` degrees. */
const rose = (fold: Fold, step: number, radius: number): Rose => {
  const n = fold % 2 === 1 ? fold : fold / 2;
  const at = (t: number) => polar(Math.sin(n * t) * radius, t - Math.PI / (2 * n));
  return {
    curve: Array.from({ length: ROSE_SAMPLES }, (_, i) => at((i / ROSE_SAMPLES) * TAU)),
    walk: Array.from({ length: 360 }, (_, i) => at(((i * step) % 360) * (TAU / 360))),
  };
};

export type ArtworkOptions = {
  readonly width: number;
  readonly height: number;
  /** The badge's diameter as a fraction of the shorter side, e.g. small enough for a maskable icon's safe zone. */
  readonly scale: number;
  readonly palette: Palette;
};

const toKebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * Colours go in `style` rather than presentation attributes, where CSS functions do not resolve in every browser. Every
 * value is generated here, so none needs escaping.
 */
const element = (
  tag: string,
  attributes: Record<string, string | number>,
  style: Record<string, string | number> = {},
) => {
  const attributeText = Object.entries(attributes).map(([name, value]) => ` ${name}="${value}"`);
  const styleText = Object.entries(style)
    .map(([name, value]) => `${toKebab(name)}:${value}`)
    .join(";");
  return `<${tag}${attributeText.join("")}${styleText === "" ? "" : ` style="${styleText}"`}/>`;
};

export const artworkSvg = (mark: Mark, { width, height, scale, palette }: ArtworkOptions): string => {
  const size = Math.min(width, height) * scale;
  const [left, top] = [(width - size) / 2, (height - size) / 2];
  const place = ([x, y]: Point) => `${(left + x * size).toFixed(1)} ${(top + y * size).toFixed(1)}`;
  const outline = (points: readonly Point[]) => `M${points.map(place).join("L")}Z`;
  const { curve, walk } = rose(mark.fold, mark.step, 0.34);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" aria-hidden="true" class="art">`,
    element("rect", { width, height }, { fill: palette.tint }),
    element("path", { d: outline(bodyOutline(mark.fold, mark.body, 0.45)) }, { fill: palette.body }),
    element(
      "path",
      { d: outline(walk) },
      { fill: "none", stroke: palette.web, strokeOpacity: 0.8, strokeWidth: (size * 0.0035).toFixed(2) },
    ),
    element(
      "path",
      { d: outline(curve) },
      { fill: "none", stroke: palette.line, strokeWidth: (size * 0.018).toFixed(2), strokeLinejoin: "round" },
    ),
    element(
      "circle",
      { cx: left + size / 2, cy: top + size / 2, r: (size * 0.035).toFixed(1) },
      { fill: palette.spark },
    ),
    "</svg>",
  ].join("");
};
