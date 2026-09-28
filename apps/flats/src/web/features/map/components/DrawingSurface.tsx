import L from "leaflet";
import { useEffect, useEffectEvent, useRef } from "react";
import { useMap } from "react-leaflet";
import type { MapLayer, MapStroke } from "../../../../contract";
import { type Point, roundDegrees, touchesPolyline } from "../utils/geometry";

export type Tool = "pen" | "eraser";

export const STROKE_OPACITY = 0.75;
/** Samples closer than this add nothing visible and only bloat the stored stroke. */
const MIN_STEP_PX = 2;
/** How far beyond a stroke's own edge the eraser still catches it. */
const ERASER_REACH_PX = 10;

type Gesture =
  | { readonly kind: "pen"; readonly pointerId: number; readonly line: L.Polyline; last: L.Point }
  | {
      readonly kind: "eraser";
      readonly pointerId: number;
      /** Visible strokes in screen space, projected once: the map cannot move while the eraser is down. */
      readonly candidates: { readonly layerId: string; readonly stroke: MapStroke; readonly points: Point[] }[];
    };

const setNavigable = (map: L.Map, navigable: boolean) => {
  for (const handler of [map.dragging, map.touchZoom, map.doubleClickZoom]) {
    if (navigable) {
      handler.enable();
    } else {
      handler.disable();
    }
  }
};

type Props = {
  readonly tool: Tool;
  /** Whether fingers and the mouse use the tool too; otherwise only Apple Pencil does, and they pan and zoom. */
  readonly touchDraws: boolean;
  /** The layer the pen draws on; `null` leaves the pen idle. */
  readonly target: Pick<MapLayer, "id" | "colour"> | null;
  readonly width: number;
  readonly layers: readonly MapLayer[];
  readonly onDraw: (layerId: string, stroke: MapStroke) => void;
  readonly onErase: (layerId: string, stroke: MapStroke) => void;
};

/**
 * Turns pointer input on the map into strokes, or erases the strokes it passes over. A pen stroke is drawn
 * imperatively while in progress and handed to `onDraw` once lifted, when it joins the React-rendered layers.
 */
export const DrawingSurface = ({ tool, touchDraws, target, width, layers, onDraw, onErase }: Props) => {
  const map = useMap();
  const gesture = useRef<Gesture | null>(null);

  useEffect(() => {
    setNavigable(map, !touchDraws);
    return () => setNavigable(map, true);
  }, [map, touchDraws]);

  const start = useEffectEvent((event: PointerEvent) => {
    const draws = event.pointerType === "pen" || touchDraws;
    if (gesture.current !== null || !draws || event.button !== 0 || (tool === "pen" && target === null)) {
      return;
    }
    // Leaflet reads touches, not pointers, on touch screens: stop it panning under the Pencil before its touch lands.
    setNavigable(map, false);
    event.preventDefault();
    const at = map.mouseEventToContainerPoint(event);
    if (tool === "pen" && target !== null) {
      const line = L.polyline([map.containerPointToLatLng(at)], {
        color: target.colour,
        weight: width,
        opacity: STROKE_OPACITY,
        interactive: false,
      }).addTo(map);
      gesture.current = { kind: "pen", pointerId: event.pointerId, line, last: at };
    } else {
      gesture.current = {
        kind: "eraser",
        pointerId: event.pointerId,
        candidates: layers
          .filter((layer) => layer.visible)
          .flatMap((layer) =>
            layer.strokes.map((stroke) => ({
              layerId: layer.id,
              stroke,
              points: stroke.points.map((point) => map.latLngToContainerPoint(point)),
            })),
          ),
      };
      erase(at);
    }
  });

  const erase = (at: Point) => {
    const current = gesture.current;
    if (current?.kind !== "eraser") {
      return;
    }
    for (let index = current.candidates.length - 1; index >= 0; index--) {
      const candidate = current.candidates[index];
      if (candidate && touchesPolyline(at, candidate.points, candidate.stroke.width / 2 + ERASER_REACH_PX)) {
        current.candidates.splice(index, 1);
        onErase(candidate.layerId, candidate.stroke);
      }
    }
  };

  const move = useEffectEvent((event: PointerEvent) => {
    const current = gesture.current;
    if (current?.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    // Pencil reports at up to 240 Hz but events arrive per frame; the coalesced samples keep curves smooth.
    for (const sample of event.getCoalescedEvents?.() ?? [event]) {
      const at = map.mouseEventToContainerPoint(sample);
      if (current.kind === "eraser") {
        erase(at);
      } else if (at.distanceTo(current.last) >= MIN_STEP_PX) {
        current.line.addLatLng(map.containerPointToLatLng(at));
        current.last = at;
      }
    }
  });

  const end = useEffectEvent((event: PointerEvent) => {
    const current = gesture.current;
    if (current?.pointerId !== event.pointerId) {
      return;
    }
    gesture.current = null;
    setNavigable(map, !touchDraws);
    if (current.kind !== "pen") {
      return;
    }
    current.line.remove();
    const points = (current.line.getLatLngs() as L.LatLng[]).map(({ lat, lng }): [number, number] => [
      roundDegrees(lat),
      roundDegrees(lng),
    ]);
    // A tap is not a stroke: it falls through as a click, e.g. to open a property's pin.
    if (event.type === "pointerup" && points.length > 1 && target !== null) {
      onDraw(target.id, { id: crypto.randomUUID(), points, width });
    }
  });

  // Strokes start on the map but are followed on the window, so one that leaves the map still ends. Capturing the
  // pointer instead would retarget a tap's click away from the pin under it.
  useEffect(() => {
    const container = map.getContainer();
    container.addEventListener("pointerdown", start);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      container.removeEventListener("pointerdown", start);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (gesture.current?.kind === "pen") {
        gesture.current.line.remove();
      }
      gesture.current = null;
    };
  }, [map]);

  return null;
};
