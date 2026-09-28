import { useMemo } from "react";
import { blit, createCanvas, type Grid, type Palette, toPaths, widthOf } from "../sprites/pixels";

export const HEART: Grid = [".hh.hh.", "hhhhhhh", "hhhhhhh", ".hhhhh.", "..hhh..", "...h..."];

/** A small pixel glyph, e.g. a bond heart, in the page's own colours. */
export const PixelIcon = ({ grid, palette, className }: { grid: Grid; palette: Palette; className?: string }) => {
  const paths = useMemo(() => {
    const canvas = createCanvas(widthOf(grid), grid.length);
    blit(canvas, grid, 0, 0, palette);
    return toPaths(canvas);
  }, [grid, palette]);
  return (
    <svg className={className} viewBox={`0 0 ${widthOf(grid)} ${grid.length}`} shapeRendering="crispEdges" aria-hidden>
      {paths.map(({ fill, d }) => (
        <path key={fill} fill={fill} d={d} />
      ))}
    </svg>
  );
};
