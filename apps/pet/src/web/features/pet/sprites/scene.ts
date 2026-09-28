import type { Accessory, Animation, Form, Species, Stage } from "../../../../contract";
import {
  blit,
  createCanvas,
  flipped,
  type Grid,
  mirrored,
  mix,
  type Palette,
  shaded,
  toPaths,
  widthOf,
} from "./pixels";
import { type Body, SPECIES_ART } from "./species";

/** The screen the pet lives on, in pixels; its feet rest on `GROUND`. */
export const SCENE_WIDTH = 24;
export const SCENE_HEIGHT = 22;
const GROUND = 19;

export type Look = {
  readonly species: Species;
  readonly stage: Stage;
  readonly form: Form | null;
  readonly accessory: Accessory | null;
};

export type Frame = readonly { readonly fill: string; readonly d: string }[];

type Eyes = "open" | "blink" | "happy" | "sad" | "pained";
type Mouth = "smile" | "open" | "frown" | "flat" | "wavy";
type Effect = "heart" | "heartHigh" | "z" | "zz" | "tear" | "sweat" | "queasy" | "dust" | "sparkle" | "sparkleLow";

type Pose = {
  readonly eyes: Eyes;
  readonly mouth: Mouth;
  readonly dx?: number;
  readonly dy?: number;
  /** Shuffles the bottom row sideways, for walking. */
  readonly feet?: number;
  readonly effects?: readonly Effect[];
};

/** Left eyes, drawn in the outline colour; the right eye is the mirror image. */
const EYES: Readonly<Record<Eyes, Grid>> = {
  open: ["wk", "kk"],
  blink: ["..", "kk"],
  happy: [".k.", "k.k"],
  sad: [".k", "kk"],
  pained: ["k.", ".k", "k."],
};

const MOUTHS: Readonly<Record<Mouth, Grid>> = {
  smile: ["k..k", ".kk."],
  open: ["kkkk", ".kk."],
  frown: [".kk.", "k..k"],
  flat: [".kk."],
  wavy: [".k.k", "k.k."],
};

const EFFECT_COLOURS: Palette = {
  h: "#ff5c8a",
  t: "#5ab4ff",
  y: "#ffd23f",
  g: "#7cc95a",
  u: "#bdb5a6",
  z: "#5d6968",
};

const EFFECTS: Readonly<Record<Effect, Grid>> = {
  heart: ["h.h", "hhh", ".h."],
  heartHigh: ["h.h", "hhh", ".h."],
  z: ["zzz", "..z", ".z.", "zzz"],
  zz: ["zzzz", "..z.", ".z..", "zzzz"],
  tear: ["t", "t"],
  sweat: [".t", "tt"],
  queasy: ["g.g.", ".g.g"],
  dust: ["u.", "uu"],
  sparkle: [".y.", "yyy", ".y."],
  sparkleLow: [".y.", "yyy", ".y."],
};

const ACCESSORY_COLOURS: Palette = { h: "#ff5c8a", q: "#c93a66", y: "#ffd23f", w: "#ffffff" };

const ACCESSORIES: Readonly<Record<Accessory, Grid>> = {
  bow: ["hh..hh", "hhqqhh", "hh..hh"],
  party_hat: [".ww.", ".hy.", "yyhh", "hhyy"],
  crown: ["y.yy.y", "yyyyyy", "yhyyhy"],
};

const POSES: Readonly<Record<Animation, readonly Pose[]>> = {
  idle: [
    { eyes: "open", mouth: "smile" },
    { eyes: "open", mouth: "smile", dy: 1 },
    { eyes: "open", mouth: "smile" },
    { eyes: "blink", mouth: "smile", dy: 1 },
  ],
  happy: [
    { eyes: "happy", mouth: "open", dy: -2, effects: ["heart"] },
    { eyes: "happy", mouth: "open", effects: ["heartHigh"] },
  ],
  walking: [
    { eyes: "open", mouth: "smile", feet: -1, effects: ["dust"] },
    { eyes: "open", mouth: "smile", dy: -1 },
    { eyes: "open", mouth: "smile", feet: 1 },
    { eyes: "open", mouth: "smile", dy: -1 },
  ],
  hungry: [
    { eyes: "sad", mouth: "frown", dy: 1 },
    { eyes: "sad", mouth: "frown", dy: 1, effects: ["tear"] },
  ],
  sleeping: [
    { eyes: "blink", mouth: "flat", dy: 1, effects: ["z"] },
    { eyes: "blink", mouth: "flat", effects: ["zz"] },
  ],
  sick: [
    { eyes: "pained", mouth: "wavy", effects: ["sweat"] },
    { eyes: "pained", mouth: "wavy", dx: 1, effects: ["queasy"] },
  ],
};

const tint = (palette: Palette, keys: readonly string[], toward: string, amount: number): Palette =>
  Object.fromEntries(
    Object.entries(palette).map(([key, colour]) => [key, keys.includes(key) ? mix(colour, toward, amount) : colour]),
  );

/** Elders grey, a scruffy adult's coat dulls, and a sick pet turns green about the gills. */
const paletteFor = ({ species, stage, form }: Look, animation: Animation): Palette => {
  let palette = SPECIES_ART[species].palette;
  if (stage === "elder") {
    palette = tint(palette, ["b", "s", "l", "a", "d"], "#d8d2c8", 0.35);
  }
  if (form === "scruffy") {
    palette = tint(palette, ["b", "s", "a", "d"], "#9c948a", 0.3);
  }
  if (animation === "sick") {
    palette = tint(palette, ["b", "s", "l"], "#9ccf6a", 0.4);
  }
  return palette;
};

const bodyFor = ({ species, stage }: Look): Body => {
  const art = SPECIES_ART[species];
  return stage === "baby" ? art.baby : stage === "child" ? art.child : art.adult;
};

const shuffleFeet = (rows: Grid, by: number): Grid =>
  by === 0
    ? rows
    : rows.map((row, index) => (index < rows.length - 1 ? row : by > 0 ? `.${row.slice(0, -1)}` : `${row.slice(1)}.`));

const drawFrame = (look: Look, animation: Animation, pose: Pose, sparkle: Effect | null): Frame => {
  const body = bodyFor(look);
  const palette = paletteFor(look, animation);
  const width = widthOf(body.rows);
  const left = Math.floor((SCENE_WIDTH - width) / 2) + (pose.dx ?? 0);
  const top = GROUND - body.rows.length + 1 + (pose.dy ?? 0);
  const right = left + width;
  const canvas = createCanvas(SCENE_WIDTH, SCENE_HEIGHT);
  const ink = { k: palette.o ?? "#1e1e1e", w: "#ffffff" };

  blit(canvas, shuffleFeet(body.rows, pose.feet ?? 0), left, top, palette);

  const eye = EYES[pose.eyes];
  const [eyeX, eyeY] = body.eye;
  blit(canvas, eye, left + eyeX, top + eyeY, ink);
  blit(canvas, flipped(eye), left + width - eyeX - widthOf(eye), top + eyeY, ink);
  if (body.mouth !== null) {
    blit(canvas, MOUTHS[pose.mouth], left + body.mouth[0], top + body.mouth[1], ink);
  }
  if (look.accessory !== null) {
    const hat = ACCESSORIES[look.accessory];
    blit(canvas, hat, left + (width - widthOf(hat)) / 2, top + body.crown - hat.length + 1, ACCESSORY_COLOURS);
  }

  const at: Readonly<Record<Effect, readonly [number, number]>> = {
    heart: [right - 1, top - 2],
    heartHigh: [right, top - 4],
    z: [right, top - 2],
    zz: [right + 1, top - 5],
    tear: [left + eyeX, top + eyeY + 2],
    sweat: [left - 2, top + 1],
    queasy: [left + width / 2 - 2, top - 3],
    dust: [left - 3, GROUND - 1],
    sparkle: [right, top],
    sparkleLow: [left - 4, top + 4],
  };
  for (const effect of [...(pose.effects ?? []), ...(sparkle === null ? [] : [sparkle])]) {
    const [x, y] = at[effect];
    blit(canvas, EFFECTS[effect], x, Math.max(0, y), EFFECT_COLOURS);
  }
  return toPaths(canvas);
};

/** A radiant adult glitters whenever it is up and about. */
const GLITTERS: ReadonlySet<Animation> = new Set(["idle", "happy", "walking"]);

export const renderFrames = (look: Look, animation: Animation): Frame[] =>
  POSES[animation].map((pose, index) =>
    drawFrame(
      look,
      animation,
      pose,
      look.form === "radiant" && GLITTERS.has(animation) ? (index % 2 === 0 ? "sparkle" : "sparkleLow") : null,
    ),
  );

const EGG_PALETTE: Palette = { o: "#5d4a3a", b: "#fff8ea", s: "#efe3cc", a: "#7cc0b5", k: "#5d4a3a" };

const EGG = shaded(
  mirrored([
    "...oo", //
    "..obb",
    ".obba",
    ".obbb",
    "obbbb",
    "oabbb",
    "oaabb",
    "obbbb",
    "obbba",
    ".obbb",
    "..ooo",
  ]),
);

const CRACK: Grid = ["k...k...k.", ".k.k.k.k.k"];

/** The unhatched egg rocking side to side, then cracking once `cracking` is set. */
export const renderEgg = (cracking: boolean): Frame[] =>
  [0, -1, 0, 1].map((lean) => {
    const canvas = createCanvas(SCENE_WIDTH, SCENE_HEIGHT);
    const left = (SCENE_WIDTH - widthOf(EGG)) / 2;
    const top = GROUND - EGG.length + 1;
    EGG.forEach((row, y) => {
      blit(canvas, [row], left + (y < EGG.length / 2 ? lean : 0), top + y, EGG_PALETTE);
    });
    if (cracking) {
      blit(canvas, CRACK, left, top + 4, EGG_PALETTE);
    }
    return toPaths(canvas);
  });
