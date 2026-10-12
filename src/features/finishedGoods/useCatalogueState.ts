"use client";
import { useCatalogueUrlState } from "@/hooks/useCatalogueUrlState";
import {
  readCatalogueState,
  serializeCatalogueState,
  type CatalogueState,
} from "./catalogueFilters";
const queryFor = (encoded: string) =>
  encoded ? `?fg=${encodeURIComponent(encoded)}` : "";
const decode = (encoded: string | null) =>
  readCatalogueState(queryFor(encoded ?? ""));
const codec = {
  decode,
  encode: (state: CatalogueState) => serializeCatalogueState(state) || null,
  readPreference(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return decode(null);
    const old = { ...(value as Record<string, unknown>) };
    // Preserve the catalogue's previous single-status preference migration.
    if (typeof old.status === "string" && old.status !== "ALL") {
      const tab = old.tab === "pallets" ? "pallets" : "products";
      old[tab] = {
        ...(typeof old[tab] === "object" ? old[tab] : {}),
        statuses: [old.status],
      };
    }
    return decode(JSON.stringify(old));
  },
  writePreference(state: CatalogueState) {
    const encoded = serializeCatalogueState(state);
    return encoded ? JSON.parse(encoded) : {};
  },
};
const options = {
  parameter: "fg",
  scopeField: "fgCatalogueScope",
  event: "fg-catalogue-state",
  codec,
};
export function useCatalogueState(viewKey: string) {
  return useCatalogueUrlState(viewKey, options);
}
