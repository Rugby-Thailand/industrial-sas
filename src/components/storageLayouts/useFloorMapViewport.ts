"use client";
import { useEffect, useRef, useState } from "react";
/** Fit the scene to the actual space left by floors, panels and the inspector. */
export function useFloorMapViewport() {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0)
        setSize({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { svg, size, aspect: size ? size.height / size.width : undefined };
}
