"use client";
import {
  useCallback,
  useSyncExternalStore,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  subscribeBrowserQuery,
  updateBrowserQuery,
} from "@/lib/browser/history";
export type FloorWorkspaceView = "map" | "list" | "split";
const event = "storage-floor-panel";
const subscribe = (listener: () => void) =>
  subscribeBrowserQuery(event, listener);
const read = (): FloorWorkspaceView => {
  const value = new URLSearchParams(window.location.search).get("panel");
  return value === "list" || value === "split" ? value : "map";
};
function useWorkspaceMedia(query: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
/** Presentation state owns only `panel`; building mode and floor navigation remain independent. */
export function useFloorWorkspaceView() {
  const requested = useSyncExternalStore(subscribe, read, () => "map" as const);
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
  const narrowScreen = useWorkspaceMedia("(max-width: 1099px)");
  const narrowInspector = useWorkspaceMedia("(max-width: 850px)");
  const narrowSplitInspector = useWorkspaceMedia("(max-width: 1399px)");
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
