import { describe, expect, test } from "bun:test";
import { ACCESSORIES, ANIMATIONS, FORMS, SPECIES, STAGES } from "../../../../contract";
import { blit, createCanvas, mirrored, mix, shaded, toPaths, widthOf } from "./pixels";
import { renderEgg, renderFrames, SCENE_WIDTH } from "./scene";
import { SPECIES_ART } from "./species";

const BODIES = SPECIES.flatMap((species) =>
  (["baby", "child", "adult"] as const).map((stage) => ({ species, stage, body: SPECIES_ART[species][stage] })),
);

describe("pixels", () => {
  test("mirrors a half and shades against the outline from the top left", () => {
    expect(mirrored(["ob", "bb"])).toEqual(["obbo", "bbbb"]);
    expect(shaded(["obbo", "oooo"])).toEqual(["osso", "oooo"]);
    expect(shaded(["bbo"])).toEqual(["bso"]);
  });

  test("draws runs of one colour as single rectangles, clipped to the canvas", () => {
    const canvas = createCanvas(4, 2);
    blit(canvas, ["aab", ".a."], 2, 0, { a: "#000000", b: "#ffffff" });

    expect(toPaths(canvas)).toEqual([{ fill: "#000000", d: "M2 0h2v1h-2zM3 1h1v1h-1z" }]);
    expect(() => blit(canvas, ["x"], 0, 0, {})).toThrow('No colour for "x"');
  });

  test("mixes colours", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#ff0000", "#0000ff", 0)).toBe("#ff0000");
  });
});

describe("species art", () => {
  test.each(BODIES)("$species $stage is rectangular, and its face sits on its body", ({ body }) => {
    const width = widthOf(body.rows);
    expect(body.rows.every((row) => row.length === width)).toBe(true);
    expect(width).toBeLessThanOrEqual(SCENE_WIDTH);
    const onBody = (x: number, y: number) => "bslp".includes(body.rows[y]?.[x] ?? ".");
    const [eyeX, eyeY] = body.eye;
    for (const [x, y] of [
      [eyeX, eyeY],
      [eyeX + 1, eyeY + 1],
      [width - eyeX - 1, eyeY + 1],
    ] as const) {
      expect(onBody(x, y)).toBe(true);
    }
    if (body.mouth !== null) {
      const [mouthX, mouthY] = body.mouth;
      expect(onBody(mouthX, mouthY) && onBody(mouthX + 3, mouthY)).toBe(true);
      expect(mouthX * 2 + 4).toBe(width);
    }
  });

  test("every look renders every animation", () => {
    for (const species of SPECIES) {
      for (const stage of STAGES) {
        for (const form of [null, ...FORMS]) {
          for (const accessory of [null, ...ACCESSORIES]) {
            for (const animation of ANIMATIONS) {
              const frames = renderFrames({ species, stage, form, accessory }, animation);
              expect(frames.length).toBeGreaterThanOrEqual(2);
              expect(frames.every((frame) => frame.length > 0)).toBe(true);
            }
          }
        }
      }
    }
  });

  test("an animation moves between frames", () => {
    const look = { species: "cat", stage: "adult", form: "steady", accessory: null } as const;
    for (const animation of ANIMATIONS) {
      const frames = renderFrames(look, animation).map((frame) => JSON.stringify(frame));
      expect(new Set(frames).size).toBeGreaterThan(1);
    }
  });

  test("sickness and age change the colours, not the shape", () => {
    const look = { species: "frog", stage: "adult", form: "steady", accessory: null } as const;
    const fills = (frame: readonly { fill: string }[]) => frame.map(({ fill }) => fill).sort();
    const [well] = renderFrames(look, "idle");
    const [elder] = renderFrames({ ...look, stage: "elder" }, "idle");

    expect(fills(elder ?? [])).not.toEqual(fills(well ?? []));
    expect(renderFrames(look, "sick")[0]?.some(({ fill }) => fill === SPECIES_ART.frog.palette.b)).toBe(false);
  });

  test("the egg rocks, then cracks", () => {
    const [rocking, cracking] = [renderEgg(false), renderEgg(true)];

    expect(rocking).toHaveLength(4);
    expect(JSON.stringify(cracking)).not.toBe(JSON.stringify(rocking));
  });
});
