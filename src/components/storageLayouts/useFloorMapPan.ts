"use client";
import { useEffect, useRef, type PointerEvent, type MouseEvent } from "react";
type Point = { x: number; y: number };
/** Pointer movement updates only the camera transform; React owns the committed camera. */
export function useFloorMapPan({
  zoom,
  center,
  frame,
  clamp,
  transform,
  onCommit,
}: {
  zoom: number;
  center: Point;
  frame: { width: number; height: number };
  clamp: (point: Point) => Point;
  transform: (point: Point) => string;
  onCommit: (point: Point) => void;
}) {
  const group = useRef<SVGGElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    unit: number;
    start: Point;
    latest: Point;
    moved: boolean;
  }>(null);
  const scheduled = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  useEffect(
    () => () => {
      if (scheduled.current !== undefined)
        cancelAnimationFrame(scheduled.current);
    },
    [],
  );
  function paint() {
    scheduled.current = undefined;
    if (drag.current)
      group.current?.setAttribute("transform", transform(drag.current.latest));
  }
  function finish(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    if (scheduled.current !== undefined)
      cancelAnimationFrame(scheduled.current);
    paint();
    drag.current = null;
    suppressClick.current = current.moved;
    event.currentTarget.style.cursor = "";
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.moved) onCommit(current.latest);
  }
  return {
    group,
    handlers: {
      onPointerDown(event: PointerEvent<SVGSVGElement>) {
        suppressClick.current = false;
        if (zoom <= 1 || event.button !== 0) return;
        const box = event.currentTarget.getBoundingClientRect();
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          unit:
            box.width > 0 && box.height > 0
              ? Math.max(frame.width / box.width, frame.height / box.height)
              : 1,
          start: center,
          latest: center,
          moved: false,
        };
      },
      onPointerMove(event: PointerEvent<SVGSVGElement>) {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x,
          dy = event.clientY - current.y;
        if (!current.moved && Math.hypot(dx, dy) < 4) return;
        if (!current.moved) {
          current.moved = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          event.currentTarget.style.cursor = "grabbing";
        }
        current.latest = clamp({
          x: current.start.x - (dx * current.unit) / zoom,
          y: current.start.y - (dy * current.unit) / zoom,
        });
        if (scheduled.current === undefined)
          scheduled.current = requestAnimationFrame(paint);
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onClickCapture(event: MouseEvent<SVGSVGElement>) {
        if (suppressClick.current) event.stopPropagation();
        suppressClick.current = false;
      },
    },
  };
}
