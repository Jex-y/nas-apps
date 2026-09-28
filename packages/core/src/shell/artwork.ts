/**
 * An identicon per app: the points of an elliptic curve y² = x³ + ax + b over a small prime field, with chords
 * joining the orbit of one point under the curve's group law. The seed picks p, a, b, the orbit and two tints mixed
 * from a palette, so each app keeps a distinctive, stable picture. It returns plain SVG markup so the same drawing
 * serves the launcher (theme variables, following light and dark mode) and the build-time app icon (fixed colours).
 */

type Point = readonly [x: number, y: number];

type Random = () => number;

type Curve = { readonly p: number; readonly a: number; readonly b: number };

const PRIMES = [37, 41, 43, 47, 53, 59, 61, 67];
/** Enough chords for a recognisable polygon; longer orbits scribble into sameness. */
const MAX_ORBIT = 14;
const GENERATOR_TRIES = 12;

/** mulberry32 seeded by FNV-1a. */
const seededRandom = (seed: string): Random => {
  let state = 2166136261;
  for (const char of seed) {
    state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

const mod = (n: number, p: number) => ((n % p) + p) % p;

/** Fermat inverse; the primes are small enough that every product stays an exact integer. */
const inverse = (n: number, p: number) => {
  let [result, base, exponent] = [1, mod(n, p), p - 2];
  while (exponent > 0) {
    if (exponent & 1) {
      result = (result * base) % p;
    }
    base = (base * base) % p;
    exponent >>= 1;
  }
  return result;
};

/** A non-singular curve, i.e. 4a³ + 27b² ≠ 0 (mod p). */
const randomCurve = (random: Random): Curve => {
  const p = pick(random, PRIMES);
  for (;;) {
    const [a, b] = [Math.floor(random() * p), Math.floor(random() * p)];
    if (mod(4 * a ** 3 + 27 * b ** 2, p) !== 0) {
      return { p, a, b };
    }
  }
};

const pointsOn = ({ p, a, b }: Curve): Point[] => {
  const roots = new Map<number, number[]>();
  for (let y = 0; y < p; y++) {
    const square = (y * y) % p;
    roots.set(square, [...(roots.get(square) ?? []), y]);
  }
  return Array.from({ length: p }, (_, x) => x).flatMap((x) =>
    (roots.get(mod(x ** 3 + a * x + b, p)) ?? []).map((y): Point => [x, y]),
  );
};

/** The group law; `null` is the point at infinity. */
const add = ({ p, a }: Curve, [x1, y1]: Point, [x2, y2]: Point): Point | null => {
  if (x1 === x2 && mod(y1 + y2, p) === 0) {
    return null;
  }
  const slope = x1 === x2 ? mod((3 * x1 * x1 + a) * inverse(2 * y1, p), p) : mod((y2 - y1) * inverse(x2 - x1, p), p);
  const x3 = mod(slope * slope - x1 - x2, p);
  return [x3, mod(slope * (x1 - x3) - y1, p)];
};

/** G, 2G, 3G, … until the orbit returns to infinity or grows long enough to fill the picture. */
const orbit = (curve: Curve, generator: Point): Point[] => {
  const multiples = [generator];
  for (let next = add(curve, generator, generator); next !== null && multiples.length < MAX_ORBIT; ) {
    multiples.push(next);
    next = add(curve, next, generator);
  }
  return multiples;
};

/** The colours to tint with and how to blend two of them; `weight` is the share of `first`, from 0 to 1. */
export type Palette = {
  readonly colours: readonly string[];
  readonly mix: (first: string, second: string, weight: number) => string;
};

export type ArtworkOptions = {
  readonly width: number;
  readonly height: number;
  /** Space kept clear around the points, e.g. a maskable icon's safe zone. */
  readonly margin: number;
  readonly palette: Palette;
  /** An opaque fill under the artwork; omitted, it shows whatever is behind it. */
  readonly background?: string;
};

/** A tint anywhere between two palette colours, so apps are not limited to the handful of theme hues. */
const tint = (random: Random, { colours, mix }: Palette): string => {
  const first = pick(random, colours);
  const second = pick(
    random,
    colours.filter((colour) => colour !== first),
  );
  return mix(first, second, random());
};

const toKebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * Colours go in `style` rather than presentation attributes, where `var()` and `color-mix()` do not resolve in every
 * browser. Every value is generated here, so none needs escaping.
 */
const element = (
  tag: string,
  attributes: Record<string, string | number>,
  style: Record<string, string | number> = {},
  children = "",
) => {
  const attributeText = Object.entries(attributes).map(([name, value]) => ` ${name}="${value}"`);
  const styleText = Object.entries(style)
    .map(([name, value]) => `${toKebab(name)}:${value}`)
    .join(";");
  return `<${tag}${attributeText.join("")}${styleText === "" ? "" : ` style="${styleText}"`}>${children}</${tag}>`;
};

const stops = (entries: readonly (readonly [offset: number, colour: string, opacity: number])[]) =>
  entries.map(([offset, stopColor, stopOpacity]) => element("stop", { offset }, { stopColor, stopOpacity })).join("");

export const artworkSvg = (seed: string, { width, height, margin, palette, background }: ArtworkOptions): string => {
  const random = seededRandom(seed);
  const curve = randomCurve(random);
  const points = pointsOn(curve);
  const affine = points.filter(([, y]) => y !== 0);
  const chords = Array.from({ length: affine.length === 0 ? 0 : GENERATOR_TRIES }, () =>
    orbit(curve, pick(random, affine)),
  ).reduce<Point[]>((longest, candidate) => (candidate.length > longest.length ? candidate : longest), []);
  const [from, to] = [tint(random, palette), tint(random, palette)];
  const id = `art-${seed}`;

  const place = ([x, y]: Point): readonly [cx: string, cy: string] => [
    (margin + (x / (curve.p - 1)) * (width - 2 * margin)).toFixed(1),
    (height - margin - (y / (curve.p - 1)) * (height - 2 * margin)).toFixed(1),
  ];
  const dots = (on: readonly Point[], r: number) =>
    on
      .map((point) => {
        const [cx, cy] = place(point);
        return element("circle", { cx, cy, r });
      })
      .join("");
  const ink = `url(#${id}-ink)`;
  const cover = (fill: string) => element("rect", { width, height }, { fill });

  const defs = [
    element(
      "linearGradient",
      { id: `${id}-wash`, x1: 0, y1: 0, x2: 1, y2: 1 },
      {},
      stops([
        [0, from, 0.28],
        [1, to, 0.08],
      ]),
    ),
    element(
      "radialGradient",
      { id: `${id}-glow` },
      {},
      stops([
        [0, to, 0.3],
        [1, to, 0],
      ]),
    ),
    // In user space so every dot takes its colour from where it sits, not from its own tiny bounding box.
    element(
      "linearGradient",
      { id: `${id}-ink`, gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2: width, y2: height },
      {},
      stops([
        [0, from, 1],
        [1, to, 1],
      ]),
    ),
  ];

  return element(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", class: "art" },
    {},
    [
      element("defs", {}, {}, defs.join("")),
      background === undefined ? "" : cover(background),
      cover(`url(#${id}-wash)`),
      cover(`url(#${id}-glow)`),
      element("g", {}, { fill: ink, opacity: 0.65 }, dots(points, 1.9)),
      element(
        "path",
        { d: chords.map((point, i) => `${i === 0 ? "M" : "L"}${place(point).join(" ")}`).join("") },
        { fill: "none", stroke: ink, strokeOpacity: 0.7, strokeWidth: 1.2, strokeLinejoin: "round" },
      ),
      element("g", {}, { fill: ink }, dots(chords, 2.8)),
    ].join(""),
  );
};
