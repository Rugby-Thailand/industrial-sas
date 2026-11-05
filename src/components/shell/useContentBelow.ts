"use client";

import { useEffect, useState, type RefObject } from "react";

/** Sub-pixel rounding and a hairline border never count as more below. */
const TOLERANCE_PX = 2;

/**
 * Whether a scrolling container has a row below its visible area. It compares
 * the bottom of the lowest visible `rowSelector` match with the container's
 * visible bottom, so the container's own bottom padding is never mistaken for
 * more content. It is measured on scroll and whenever the container or one of
 * its direct children resizes, e.g. as destinations load or a submenu opens.
 */
export function useContentBelow(
  container: RefObject<HTMLElement | null>,
  rowSelector: string,
): boolean {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      let lastRowBottom: number | undefined;
      for (const row of element.querySelectorAll(rowSelector)) {
        const box = row.getBoundingClientRect();
        // Rows inside a closed submenu have no box.
        if (box.height === 0) continue;
        lastRowBottom = Math.max(lastRowBottom ?? box.bottom, box.bottom);
      }
      const visibleBottom =
        element.getBoundingClientRect().top +
        element.clientTop +
        element.clientHeight;
      setBelow(
        lastRowBottom !== undefined &&
          lastRowBottom - visibleBottom > TOLERANCE_PX,
      );
    };
    // Each observe() reports once, so this also takes the first measurement.
    const resize = new ResizeObserver(measure);
    const observe = () => {
      resize.observe(element);
      for (const child of element.children) resize.observe(child);
    };
    observe();
    const children = new MutationObserver(observe);
    children.observe(element, { childList: true });
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      resize.disconnect();
      children.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [container, rowSelector]);
  return below;
}
