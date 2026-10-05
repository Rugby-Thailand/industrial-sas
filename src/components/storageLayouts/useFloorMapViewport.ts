"use client";
import { useEffect, useRef, useState } from "react";
/** Fit the scene to the actual space left by floors, panels and the inspector. */
export function useFloorMapViewport() {
  const svg = useRef<SVGSVGElement>(null);
  const [aspect, setAspect] = useState<number>();
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0)
        setAspect(box.height / box.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { svg, aspect };
}
