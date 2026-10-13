"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { updateBrowserQuery } from "@/lib/browser/history";
import { useBrowserQuery } from "@/hooks/useBrowserQuery";
import { useMediaQuery } from "@/hooks/useMediaQuery";
export type FloorWorkspaceView = "map" | "list" | "split";
const event = "storage-floor-panel";
const read = (search: string): FloorWorkspaceView => {
  const value = new URLSearchParams(search).get("panel");
  return value === "list" || value === "split" ? value : "map";
};
/** Presentation state owns only `panel`; building mode and floor navigation remain independent. */
export function useFloorWorkspaceView() {
  const requested = read(useBrowserQuery(event).search);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();
  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined && next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const narrowScreen = useMediaQuery("(max-width: 1099px)");
  const narrowInspector = useMediaQuery("(max-width: 850px)");
  const narrowSplitInspector = useMediaQuery("(max-width: 1399px)");
  const narrow = width === undefined ? narrowScreen : width < 1100;
  const view = requested === "split" && narrow ? "map" : requested;
  const setView = useCallback((next: FloorWorkspaceView) => {
    updateBrowserQuery(
      (query) => {
        if (next === "map") query.delete("panel");
        else query.set("panel", next);
      },
      { event },
    );
  }, []);
  return {
    view,
    setView,
    canSplit: !narrow,
    workspaceRef,
    compactInspector:
      (width === undefined ? narrowInspector : width < 851) ||
      (view === "split" &&
        (width === undefined ? narrowSplitInspector : width < 1400)),
  };
}
