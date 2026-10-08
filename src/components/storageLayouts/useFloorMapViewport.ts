"use client";
import { useEffect, useRef, useState } from "react";
/** Fit the scene to the actual space left by floors, panels and the inspector. */
export function useFloorMapViewport() {
  const svg = useRef<SVGSVGElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [footerHeight, setFooterHeight] = useState(0);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries.find(
        (entry) => entry.target === element,
      )?.contentRect;
      if (box && box.width > 0 && box.height > 0)
        setSize((current) =>
          current?.width === box.width && current.height === box.height
            ? current
            : { width: box.width, height: box.height },
        );
      const footerBox = entries.find(
        (entry) => entry.target === footer.current,
      )?.contentRect;
      if (footerBox) setFooterHeight(footerBox.height);
    });
    observer.observe(element);
    if (footer.current) observer.observe(footer.current);
    return () => observer.disconnect();
  }, []);
  return {
    svg,
    footer,
    footerHeight,
    size,
    aspect: size ? size.height / size.width : undefined,
  };
}
