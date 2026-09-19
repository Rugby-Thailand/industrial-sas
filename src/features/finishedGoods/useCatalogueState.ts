"use client";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  readCatalogueState,
  serializeCatalogueState,
  type CatalogueState,
} from "./catalogueFilters";
const event = "fg-catalogue-state";
const scopeField = "fgCatalogueScope";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(event, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(event, listener);
  };
}
const queryFor = (encoded: string) =>
  encoded ? `?fg=${encodeURIComponent(encoded)}` : "";
function savedQuery(key: string) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return "";
    const old = JSON.parse(raw);
    // Migrate the catalogue's previous single-status preference.
    if (
      old &&
      typeof old === "object" &&
      typeof old.status === "string" &&
      old.status !== "ALL"
    ) {
      const tab = old.tab === "pallets" ? "pallets" : "products";
      old[tab] = { ...old[tab], statuses: [old.status] };
    }
    return queryFor(
      serializeCatalogueState(
        readCatalogueState(queryFor(JSON.stringify(old))),
      ),
    );
  } catch {
    return "";
  }
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
    const url = new URL(window.location.href);
    const next = { ...readCatalogueState(getSnapshot()), ...change };
    const encoded = serializeCatalogueState(next);
    fallback.current = queryFor(encoded);
    try {
      localStorage.setItem(viewKey, encoded || "{}");
    } catch {
      /* URL state still works without storage. */
    }
    if (encoded) url.searchParams.set("fg", encoded);
    else url.searchParams.delete("fg");
    // Next's patched history API must see this as an external update. Passing its
    // internal markers back would bypass router synchronization and revert filters.
    const historyData = { ...window.history.state, [scopeField]: viewKey };
    delete historyData.__NA;
    delete historyData._N;
    window.history.replaceState(
      historyData,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    window.dispatchEvent(new Event(event));
  }
  return { state, update };
}
