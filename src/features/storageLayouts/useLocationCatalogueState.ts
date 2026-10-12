"use client";

import { useCatalogueUrlState } from "@/hooks/useCatalogueUrlState";

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

const codec = {
  decode(encoded: string | null) {
    try {
      return encoded ? read(JSON.parse(encoded)) : initial;
    } catch {
      return initial;
    }
  },
  encode: (state: LocationCatalogueState) => JSON.stringify(state),
  readPreference: read,
  writePreference: (state: LocationCatalogueState) => state,
};
const options = {
  parameter: "locations",
  scopeField: "locationCatalogueScope",
  event: "location-catalogue-state",
  codec,
};
export function useLocationCatalogueState(key: string) {
  return useCatalogueUrlState(key, options);
}
