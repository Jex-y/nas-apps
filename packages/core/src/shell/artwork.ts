/**
 * An identicon per app: the points of an elliptic curve y² = x³ + ax + b over a small prime field, with chords
 * joining the orbit of one point under the curve's group law. The seed picks p, a, b, the orbit and two tints mixed
 * from the theme colours, so each app keeps a distinctive, stable picture that follows light and dark mode.
 */

type Point = readonly [x: number, y: number];

type Random = () => number;

type Curve = { readonly p: number; readonly a: number; readonly b: number };

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 300;
const HEIGHT = 200;
const MARGIN = 14;
const PRIMES = [37, 41, 43, 47, 53, 59, 61, 67];
/** Enough chords for a recognisable polygon; longer orbits scribble into sameness. */
const MAX_ORBIT = 14;
const GENERATOR_TRIES = 12;
const THEME_COLOURS = ["var(--accent)", "var(--accent-2)", "var(--warning-fg)", "var(--error)"];

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

/** A tint anywhere between two theme colours, so apps are not limited to the handful of theme hues. */
const tint = (random: Random): string => {
  const first = pick(random, THEME_COLOURS);
  const second = pick(
    random,
    THEME_COLOURS.filter((colour) => colour !== first),
  );
  return `color-mix(in oklch, ${first} ${Math.round(random() * 100)}%, ${second})`;
};

const create = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
  style: Partial<CSSStyleDeclaration> = {},
): SVGElementTagNameMap[K] => {
  const created = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    created.setAttribute(name, value);
  }
  // Set as styles, not presentation attributes, so `var()` and `color-mix()` resolve in every browser.
  Object.assign(created.style, style);
  return created;
};

const gradient = (
  tag: "linearGradient" | "radialGradient",
  attributes: Record<string, string>,
  stops: readonly (readonly [offset: string, colour: string, opacity: string])[],
) => {
  const created = create(tag, attributes);
  created.append(
    ...stops.map(([offset, stopColor, stopOpacity]) => create("stop", { offset }, { stopColor, stopOpacity })),
  );
  return created;
};

export const artwork = (seed: string): SVGSVGElement => {
  const random = seededRandom(seed);
  const curve = randomCurve(random);
  const points = pointsOn(curve);
  const affine = points.filter(([, y]) => y !== 0);
  const chords = Array.from({ length: affine.length === 0 ? 0 : GENERATOR_TRIES }, () =>
    orbit(curve, pick(random, affine)),
  ).reduce<Point[]>((longest, candidate) => (candidate.length > longest.length ? candidate : longest), []);
  const [from, to] = [tint(random), tint(random)];
  const id = `art-${seed}`;

  const place = ([x, y]: Point): Point => [
    MARGIN + (x / (curve.p - 1)) * (WIDTH - 2 * MARGIN),
    HEIGHT - MARGIN - (y / (curve.p - 1)) * (HEIGHT - 2 * MARGIN),
  ];
  const dot = (point: Point, r: number) => {
    const [cx, cy] = place(point);
    return create("circle", { cx: cx.toFixed(1), cy: cy.toFixed(1), r: String(r) });
  };

  const defs = create("defs", {});
  defs.append(
    gradient("linearGradient", { id: `${id}-wash`, x1: "0", y1: "0", x2: "1", y2: "1" }, [
      ["0", from, "0.28"],
      ["1", to, "0.08"],
    ]),
    gradient("radialGradient", { id: `${id}-glow` }, [
      ["0", to, "0.3"],
      ["1", to, "0"],
    ]),
    // In user space so every dot takes its colour from where it sits, not from its own tiny bounding box.
    gradient(
      "linearGradient",
      { id: `${id}-ink`, gradientUnits: "userSpaceOnUse", x1: "0", y1: "0", x2: String(WIDTH), y2: String(HEIGHT) },
      [
        ["0", from, "1"],
        ["1", to, "1"],
      ],
    ),
  );

  const ink = `url(#${id}-ink)`;
  const field = create("g", {}, { fill: ink, opacity: "0.65" });
  field.append(...points.map((point) => dot(point, 1.9)));
  const path = chords.map(
    (point, i) =>
      `${i === 0 ? "M" : "L"}${place(point)
        .map((n) => n.toFixed(1))
        .join(" ")}`,
  );
  const highlighted = create("g", {}, { fill: ink });
  highlighted.append(...chords.map((point) => dot(point, 2.8)));

  const svg = create("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, "aria-hidden": "true", class: "art" });
  svg.append(
    defs,
    create("rect", { width: String(WIDTH), height: String(HEIGHT) }, { fill: `url(#${id}-wash)` }),
    create("rect", { width: String(WIDTH), height: String(HEIGHT) }, { fill: `url(#${id}-glow)` }),
    field,
    create(
      "path",
      { d: path.join("") },
      { fill: "none", stroke: ink, strokeOpacity: "0.7", strokeWidth: "1.2", strokeLinejoin: "round" },
    ),
    highlighted,
  );
  return svg;
};
