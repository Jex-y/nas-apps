import { describe, expect, test } from "bun:test";
import type { PropertyDetail } from "../../../../contract";
import { firstOf, type Slide, slideBindings, slidesOf } from "./slides";

type Located = Pick<PropertyDetail, "photos" | "thumbnailUrl" | "latitude" | "longitude">;

const property = (overrides: Partial<Located>) =>
  ({ photos: [], thumbnailUrl: null, latitude: null, longitude: null, ...overrides }) as PropertyDetail;

const photo = (kind: "photo" | "floorplan", url: string) => ({ id: url, kind, url });

describe("slidesOf", () => {
  test("puts photos first, then floorplans, then the map", () => {
    const slides = slidesOf(
      property({
        photos: [photo("floorplan", "plan"), photo("photo", "front"), photo("photo", "back")],
        latitude: 51.5,
        longitude: -0.1,
      }),
    );
    expect(slides.map((slide) => (slide.kind === "map" ? "map" : slide.url))).toEqual(["front", "back", "plan", "map"]);
  });

  test("falls back to the thumbnail when no photo is stored", () => {
    expect(slidesOf(property({ thumbnailUrl: "thumb" }))).toEqual([{ kind: "photo", url: "thumb" }]);
  });

  test("has no map for a property with no known location", () => {
    expect(firstOf(slidesOf(property({ photos: [photo("photo", "front")], latitude: 51.5 })), "map")).toBeNull();
  });
});

describe("slideBindings", () => {
  const slides: Slide[] = [
    { kind: "photo", url: "front" },
    { kind: "photo", url: "back" },
    { kind: "floorplan", url: "plan" },
    { kind: "map", latitude: 51.5, longitude: -0.1 },
  ];
  const press = (key: string, index: number, over: readonly Slide[] = slides) => {
    const steps: number[] = [];
    slideBindings(over, index, (step) => steps.push(step))
      .find((binding) => binding.keys.includes(key))
      ?.run();
    return steps;
  };

  test("steps one slide, stopping at either end", () => {
    expect(press("l", 1)).toEqual([2]);
    expect(press("l", 3)).toEqual([3]);
    expect(press("h", 1)).toEqual([0]);
    expect(press("h", 0)).toEqual([0]);
  });

  test("jumps to either end, the floorplan and the map", () => {
    expect(press("0", 2)).toEqual([0]);
    expect(press("$", 0)).toEqual([3]);
    expect(press("f", 0)).toEqual([2]);
    expect(press("m", 0)).toEqual([3]);
  });

  test("stays put when there is no such slide", () => {
    expect(press("m", 1, slides.slice(0, 2))).toEqual([1]);
    expect(press("l", 0, [])).toEqual([0]);
  });
});
