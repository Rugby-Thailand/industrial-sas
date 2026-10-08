"use client";

import { useCallback, useState } from "react";

/** Camera coordinates stay in the projected scene, before viewport fitting. */
export function useFloorMapCamera(initialView: "3d" | "plan" = "plan") {
  const [view, setView] = useState(initialView);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState<{ x: number; y: number }>();
  const [rotation, setRotation] = useState(0);
  const [reference, setReference] = useState(false);
  const [showPackages, setShowPackages] = useState(false);
  const fit = useCallback(() => {
    setZoom(1);
    setFocus(undefined);
  }, []);

  return {
    view,
    zoom,
    focus,
    rotation,
    reference,
    showPackages,
    setFocus,
    setZoom,
    fit,
    changeView(next: "3d" | "plan") {
      setView(next);
      setFocus(undefined);
    },
    zoomIn() {
      setZoom((current) => Math.min(8, current + (current >= 3 ? 1 : 0.25)));
    },
    zoomOut() {
      const next = Math.max(1, zoom - (zoom > 3 ? 1 : 0.25));
      setZoom(next);
      if (next === 1) setFocus(undefined);
    },
    rotate() {
      setRotation((current) => (current + 1) % 4);
      setFocus(undefined);
    },
    toggleReference() {
      setReference((current) => !current);
      setFocus(undefined);
    },
    togglePackages() {
      setShowPackages((current) => !current);
    },
  };
}
