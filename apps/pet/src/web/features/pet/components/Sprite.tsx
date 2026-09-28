import { useEffect, useState } from "react";
import { type Frame, SCENE_HEIGHT, SCENE_WIDTH } from "../sprites/scene";

const FRAME_MS = 450;

/** Loops through pre-rendered frames; crisp at any size because each pixel is a unit square. */
export const Sprite = ({ frames, label }: { frames: readonly Frame[]; label: string }) => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), FRAME_MS);
    return () => clearInterval(timer);
  }, []);

  const frame = frames[tick % frames.length] ?? [];
  return (
    <svg
      className="sprite"
      viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      {frame.map(({ fill, d }) => (
        <path key={fill} fill={fill} d={d} />
      ))}
    </svg>
  );
};
