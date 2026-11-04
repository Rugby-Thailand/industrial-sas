"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Whether a scrolling container has content below its visible area. It is
 * measured on scroll and whenever the container or one of its direct children
 * resizes, e.g. as destinations load or a submenu opens.
 */
export function useContentBelow(
  container: RefObject<HTMLElement | null>,
): boolean {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () =>
      setBelow(
        element.scrollHeight - element.scrollTop - element.clientHeight > 1,
      );
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
  }, [container]);
  return below;
}
