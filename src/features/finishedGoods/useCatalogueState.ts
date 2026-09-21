"use client";
import { preferences } from "@/lib/browser/storage";
import {
  subscribeBrowserQuery,
  updateBrowserQuery,
} from "@/lib/browser/history";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  readCatalogueState,
  serializeCatalogueState,
  type CatalogueState,
} from "./catalogueFilters";
const event = "fg-catalogue-state";
const scopeField = "fgCatalogueScope";
const subscribe = (listener: () => void) =>
  subscribeBrowserQuery(event, listener);
const queryFor = (encoded: string) =>
  encoded ? `?fg=${encodeURIComponent(encoded)}` : "";
function savedQuery(key: string) {
  return preferences.read(
    key,
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return "";
      const old = value as Record<string, unknown>;
      // Migrate the catalogue's previous single-status preference.
      if (
        old &&
        typeof old === "object" &&
        typeof old.status === "string" &&
        old.status !== "ALL"
      ) {
        const tab = old.tab === "pallets" ? "pallets" : "products";
        old[tab] = {
          ...(typeof old[tab] === "object" ? old[tab] : {}),
          statuses: [old.status],
        };
      }
      return queryFor(
        serializeCatalogueState(
          readCatalogueState(queryFor(JSON.stringify(old))),
        ),
      );
    },
    "",
  );
}
export function useCatalogueState(viewKey: string) {
  const [initialQuery] = useState(() => savedQuery(viewKey));
  const fallback = useRef(initialQuery);
  const getSnapshot = () => {
    const scope = window.history.state?.[scopeField];
    if (
      scope === viewKey ||
      (!scope && new URLSearchParams(window.location.search).has("fg"))
    )
      return window.location.search;
    return fallback.current;
  };
  const search = useSyncExternalStore(subscribe, getSnapshot, () => "");
  const state = useMemo(() => readCatalogueState(search), [search]);
  function update(change: Partial<CatalogueState>) {
    const next = { ...readCatalogueState(getSnapshot()), ...change };
    const encoded = serializeCatalogueState(next);
    fallback.current = queryFor(encoded);
    preferences.write(viewKey, encoded ? JSON.parse(encoded) : {});
    updateBrowserQuery(
      (query) => {
        if (encoded) query.set("fg", encoded);
        else query.delete("fg");
      },
      { metadata: { [scopeField]: viewKey }, event },
    );
  }
  return { state, update };
}
