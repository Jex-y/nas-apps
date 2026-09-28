import type { Species } from "../../../../contract";
import { type Grid, mirrored, type Palette, shaded } from "./pixels";

/**
 * Every creature faces us and is drawn left half only, then mirrored and shaded, so each stays symmetric and lit
 * the same way. Keys: `o` outline, `b` body (`s`, its shade, is added), `l` belly, `a` and `d` markings, `p` blush.
 * Eyes and mouths are drawn over the body by the scene, so one body serves every expression.
 */
export type Body = {
  readonly rows: Grid;
  /** Top-left of the left eye; the right eye mirrors it. */
  readonly eye: readonly [number, number];
  /** Top-left of the four-pixel mouth; `null` where a beak does the job. */
  readonly mouth: readonly [number, number] | null;
  /** The row a hat rests on. */
  readonly crown: number;
};

export type Art = {
  readonly palette: Palette;
  readonly baby: Body;
  readonly child: Body;
  readonly adult: Body;
};

const body = (half: Grid, parts: Omit<Body, "rows">): Body => ({ rows: shaded(mirrored(half)), ...parts });

export const SPECIES_ART: Readonly<Record<Species, Art>> = {
  chick: {
    palette: { o: "#6b4423", b: "#ffd84d", s: "#f0b429", l: "#fff3b0", a: "#ff9a3c", d: "#e0662a", p: "#ffa3b1" },
    baby: body(
      [
        "....o", //
        "..ooo",
        ".obbb",
        "obbbb",
        "obbbb",
        "obpba",
        "obbbd",
        ".obll",
        "..ooo",
        "...a.",
      ],
      { eye: [2, 3], mouth: null, crown: 1 },
    ),
    child: body(
      [
        "....o.", //
        "...ooo",
        "..obbb",
        ".obbbb",
        "obbbbb",
        "obbbbb",
        "obpbba",
        "obbbbd",
        "obobll",
        "obbbll",
        ".obbll",
        "..oooo",
        "...a..",
      ],
      { eye: [3, 4], mouth: null, crown: 1 },
    ),
    adult: body(
      [
        ".......o", //
        "......o.",
        "....oooo",
        "...obbbb",
        "..obbbbb",
        ".obbbbbb",
        ".obbbbbb",
        "obbpbbba",
        "obbbbbbd",
        "obobbbll",
        "obbobbll",
        "obbbllll",
        ".obbllll",
        "..obblll",
        "...ooooo",
        "....aa..",
      ],
      { eye: [4, 5], mouth: null, crown: 2 },
    ),
  },
  frog: {
    palette: { o: "#274b2f", b: "#7fcf6f", s: "#5aaf57", l: "#e3f5c4", a: "#f59ab0", d: "#3f8a45", p: "#f59ab0" },
    baby: body(
      [
        ".ooo.", //
        "obbbo",
        "obbbb",
        "obbbb",
        "obpbb",
        ".obbl",
        "..ooo",
        "..o..",
      ],
      { eye: [2, 1], mouth: [3, 4], crown: 0 },
    ),
    child: body(
      [
        ".oooo.", //
        "obbbbo",
        "obbbbb",
        "obbbbb",
        "obbbbb",
        "opbbbb",
        ".obbll",
        "obbbll",
        "obdbll",
        ".oo.oo",
      ],
      { eye: [2, 1], mouth: [4, 4], crown: 0 },
    ),
    adult: body(
      [
        "..oooo..", //
        ".obbbbo.",
        ".obbbbbo",
        "obbbbbbb",
        "obbbbbbb",
        "obbbbbbb",
        "obpbbbbb",
        ".obbbbll",
        "obbbblll",
        "obdbllll",
        "obbdblll",
        ".oo.oooo",
      ],
      { eye: [3, 2], mouth: [6, 5], crown: 0 },
    ),
  },
  cat: {
    palette: { o: "#5a3522", b: "#f6a55a", s: "#de8537", l: "#fff1dc", a: "#f7b6c2", d: "#d27a2e", p: "#ff9fb0" },
    baby: body(
      [
        "o....", //
        "oao..",
        "obaoo",
        "obbbb",
        "obbbb",
        "obbbb",
        "opbbb",
        ".obbl",
        "..ooo",
      ],
      { eye: [2, 4], mouth: [3, 6], crown: 2 },
    ),
    child: body(
      [
        ".o....", //
        ".oo...",
        ".oao..",
        "obaaoo",
        "obbbbd",
        "obbbbb",
        "obbbbb",
        "opbbbb",
        ".obbbl",
        "..obll",
        ".obbll",
        ".oo.oo",
      ],
      { eye: [3, 5], mouth: [4, 7], crown: 3 },
    ),
    adult: body(
      [
        ".o......", //
        ".oo.....",
        ".oao....",
        ".oaao...",
        "obaabooo",
        "obbbbbdb",
        "obbbbbbb",
        "obbbbbbb",
        "obbbbbbb",
        "obpbbbbb",
        ".obbbbbb",
        "..obbbll",
        "..obblll",
        ".odbllll",
        ".obbllll",
        "..oo.ooo",
      ],
      { eye: [4, 7], mouth: [6, 9], crown: 4 },
    ),
  },
  bunny: {
    palette: { o: "#5a4550", b: "#ecd9c3", s: "#d6bea3", l: "#fffaf2", a: "#f8b3c8", d: "#c9ab8b", p: "#ffa3bb" },
    baby: body(
      [
        ".oo..", //
        ".oao.",
        ".oao.",
        ".oboo",
        "obbbb",
        "obbbb",
        "opbbb",
        ".obbl",
        "..ooo",
      ],
      { eye: [2, 4], mouth: [3, 6], crown: 3 },
    ),
    child: body(
      [
        ".oo...", //
        ".oao..",
        ".oao..",
        ".oao..",
        ".obaoo",
        "obbbbb",
        "obbbbb",
        "obbbbb",
        "opbbbb",
        ".obbll",
        "..obll",
        ".oo.oo",
      ],
      { eye: [3, 6], mouth: [4, 8], crown: 4 },
    ),
    adult: body(
      [
        "..oo....", //
        ".oaao...",
        ".oaao...",
        ".oaao...",
        ".oaao...",
        "..oaoooo",
        ".obbbbbb",
        "obbbbbbb",
        "obbbbbbb",
        "obbbbbbb",
        "obpbbbbb",
        ".obbbbbb",
        "..obblll",
        ".obbllll",
        ".obbllll",
        "..ooo.oo",
      ],
      { eye: [4, 8], mouth: [6, 10], crown: 5 },
    ),
  },
  axolotl: {
    palette: { o: "#6b2a45", b: "#ffb6cb", s: "#f28fab", l: "#ffe3ea", a: "#ff6d95", d: "#e2587f", p: "#ff7fa5" },
    baby: body(
      [
        "a.ooo", //
        ".obbb",
        "aobbb",
        ".obbb",
        "aobbb",
        ".opbl",
        "..ooo",
      ],
      { eye: [2, 2], mouth: [3, 4], crown: 0 },
    ),
    child: body(
      [
        "a..ooo", //
        ".a.obb",
        "aaobbb",
        "..obbb",
        "aaobbb",
        "..obbb",
        "..opbb",
        "...obl",
        "..obll",
        "..obll",
        "..oo.o",
      ],
      { eye: [3, 3], mouth: [4, 5], crown: 0 },
    ),
    adult: body(
      [
        "a...oooo", //
        ".a.obbbb",
        "aaobbbbb",
        "..obbbbb",
        "aaobbbbb",
        ".a.obbbb",
        "a..obbbb",
        "...opbbb",
        "....obll",
        "...obbll",
        "..obblll",
        "..obblll",
        "...oo.oo",
      ],
      { eye: [4, 3], mouth: [6, 6], crown: 0 },
    ),
  },
  dragon: {
    palette: { o: "#33245e", b: "#9d8cf5", s: "#7a67e0", l: "#ffe7a3", a: "#ffc83d", d: "#5fc6b0", p: "#ff9fd0" },
    baby: body(
      [
        "..a..", //
        "..ooo",
        ".obbb",
        "obbbb",
        "obbbb",
        "dobbl",
        ".obll",
        "..ooo",
        "..o..",
      ],
      { eye: [2, 3], mouth: [3, 5], crown: 1 },
    ),
    child: body(
      [
        "..a...", //
        "..ao..",
        "..oooo",
        ".obbbb",
        "obbbbb",
        "obbbbb",
        "dobbbb",
        "ddobll",
        ".dobll",
        "..obll",
        "..oooo",
        "..o...",
      ],
      { eye: [3, 4], mouth: [4, 6], crown: 2 },
    ),
    adult: body(
      [
        "...a....", //
        "...aa...",
        "....aooo",
        "...obbbb",
        "..obbbbb",
        ".obbbbbb",
        ".obbbbbb",
        ".obbbbbb",
        "dd.obbbb",
        "ddoobbll",
        "ddobblll",
        ".dobllll",
        "..obllll",
        "...obbll",
        "...oo.oo",
      ],
      { eye: [4, 5], mouth: [6, 7], crown: 2 },
    ),
  },
};
