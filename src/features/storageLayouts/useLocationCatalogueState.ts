"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { preferences } from "@/lib/browser/storage";
import {
  subscribeBrowserQuery,
  updateBrowserQuery,
} from "@/lib/browser/history";
import { useQueryHistoryWriter } from "@/hooks/useQueryHistoryWriter";

export type LocationCatalogueState = {
  view: "cards" | "table";
  search: string;
  status: "ALL" | "DRAFT" | "ACTIVE" | "ARCHIVED";
  building: string;
  floor: string;
};
const initial: LocationCatalogueState = {
  view: "cards",
  search: "",
  status: "ALL",
  building: "ALL",
  floor: "ALL",
};
const event = "location-catalogue-state";
const scopeField = "locationCatalogueScope";
const subscribe = (listener: () => void) =>
  subscribeBrowserQuery(event, listener);

function read(value: unknown): LocationCatalogueState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return initial;
  const p = value as Record<string, unknown>;
  if (
    (p.view === "cards" || p.view === "table") &&
    (p.status === "ALL" ||
      p.status === "DRAFT" ||
      p.status === "ACTIVE" ||
      p.status === "ARCHIVED") &&
    typeof p.search === "string" &&
    typeof p.building === "string" &&
    typeof p.floor === "string" &&
    (p.floor === "ALL" || /^[1-9]\d*$/.test(p.floor))
  ) {
    return {
      view: p.view,
      status: p.status,
      search: p.search,
      building: p.building,
      floor: p.floor,
    };
  }
  return initial;
}

export function useLocationCatalogueState(key: string) {
  const [fallback] = useState(() =>
    JSON.stringify(preferences.read(key, read, initial)),
  );
  const snapshot = () => {
    const query = new URLSearchParams(window.location.search);
    const scope = window.history.state?.[scopeField];
    return scope === key || (!scope && query.has("locations"))
      ? (query.get("locations") ?? JSON.stringify(initial))
      : fallback;
  };
  const encoded = useSyncExternalStore(subscribe, snapshot, () =>
    JSON.stringify(initial),
  );
  const state = useMemo(() => {
    try {
      return read(JSON.parse(encoded));
    } catch {
      return initial;
    }
  }, [encoded]);
  const write = useQueryHistoryWriter();
  function update(patch: Partial<LocationCatalogueState>) {
    const next = { ...state, ...patch };
    const serialized = JSON.stringify(next);
    if (serialized === JSON.stringify(state)) return;
    // Pin the starting view before preferences change so Back restores that view.
    if (window.history.state?.[scopeField] !== key) {
      updateBrowserQuery(
        (query) => query.set("locations", JSON.stringify(state)),
        { metadata: { [scopeField]: key }, event },
      );
    }
    preferences.write(key, next);
    write((query) => query.set("locations", serialized), {
      metadata: { [scopeField]: key },
      event,
      typing: Object.keys(patch).length === 1 && patch.search !== undefined,
    });
  }
  return { state, update };
}
