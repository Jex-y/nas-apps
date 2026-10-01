import { describe, expect, test } from "bun:test";
import { decodeTrack, encodeTrack, GpxError, parseGpx } from "./track";

const exported = await Bun.file(new URL("../../test/fixtures/gpx/strava-export.gpx", import.meta.url)).text();
const fallback = { name: "upload", startAt: new Date("2026-01-01T00:00:00Z") };

describe("GPX", () => {
  test("reads a Strava export: name, type, start, and every valid point in order", () => {
    const gpx = parseGpx(exported, fallback);

    expect(gpx.name).toBe("Bank & Monument loop");
    expect(gpx.sportType).toBe("Run");
    expect(gpx.startAt).toEqual(new Date("2026-09-20T07:30:05Z"));
    expect(gpx.track.latlng).toEqual([
      [51.51331, -0.08894],
      [51.51318, -0.08847],
      [51.51306, -0.08799],
      [51.51293, -0.08751],
      [51.5128, -0.08703],
    ]);
    expect(gpx.track.time).toEqual([0, 6, 12, 18, 0]);
    expect(gpx.distanceMetres).toBeGreaterThan(130);
    expect(gpx.distanceMetres).toBeLessThan(145);
  });

  test("falls back to the file's name and date when the GPX has neither", () => {
    const gpx = parseGpx(
      `<gpx><trk><trkseg><trkpt lat="51.5" lon="-0.1"></trkpt><trkpt lat="51.501" lon="-0.1"></trkpt></trkseg></trk></gpx>`,
      fallback,
    );
    expect(gpx).toMatchObject({ name: "upload", sportType: "Run", startAt: fallback.startAt });
  });

  test("reads walks and hikes by name or number", () => {
    const withType = (type: string) =>
      parseGpx(`<gpx><trk><type>${type}</type><trkseg><trkpt lat="51.5" lon="-0.1"/></trkseg></trk></gpx>`, fallback)
        .sportType;
    expect(withType("walking")).toBe("Walk");
    expect(withType("10")).toBe("Walk");
    expect(withType("hiking")).toBe("Hike");
  });

  test("refuses a file without track points", () => {
    expect(() => parseGpx("<gpx><rte><rtept lat='51.5' lon='-0.1'/></rte></gpx>", fallback)).toThrow(GpxError);
    expect(() => parseGpx("not xml at all", fallback)).toThrow(GpxError);
  });
});

describe("stored tracks", () => {
  test("round-trip through gzip", () => {
    const track = { latlng: [[51.5, -0.1] as const, [51.501, -0.1] as const], time: [0, 30] };
    expect(decodeTrack(encodeTrack(track))).toEqual({ latlng: [[51.5, -0.1], [51.501, -0.1]], time: [0, 30] });
  });
});
