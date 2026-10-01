import { describe, expect, test } from "bun:test";
import { decodeExport } from "./decode";

describe("decodeExport", () => {
  test("reads UTF-8 and Windows-1252 exports alike", () => {
    const utf8 = new TextEncoder().encode("Value (£)").buffer as ArrayBuffer;
    const windows = new Uint8Array([...new TextEncoder().encode("Value ("), 0xa3, 0x29]).buffer;

    expect(decodeExport(utf8)).toBe("Value (£)");
    expect(decodeExport(windows)).toBe("Value (£)");
  });
});
