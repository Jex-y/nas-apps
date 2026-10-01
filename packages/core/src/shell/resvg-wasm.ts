/**
 * Imported as a Bun macro, so resvg's WebAssembly is inlined while bundling and the built server needs no node_modules
 * to rasterise icons. Gzipped then base64, since a macro can only return plain data.
 */
export const resvgWasm = async (): Promise<string> => {
  const wasm = await Bun.file(Bun.resolveSync("@resvg/resvg-wasm/index_bg.wasm", import.meta.dir)).arrayBuffer();
  return Buffer.from(Bun.gzipSync(wasm)).toString("base64");
};
