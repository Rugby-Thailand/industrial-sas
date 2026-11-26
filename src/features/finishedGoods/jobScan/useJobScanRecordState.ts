"use client";

import { useCatalogueUrlState } from "@/hooks/useCatalogueUrlState";
import type {
  JobScanFilter,
  JobScanSearchFacets,
} from "../../../../convex/model/finishedGoods/jobScans";

export type JobScanRecordState = {
  filter: JobScanFilter;
  search: string;
  exactCode?: true | undefined;
  locationId?: string | undefined;
  facets?: JobScanSearchFacets | undefined;
};

const initial: JobScanRecordState = { filter: "UNMAPPED", search: "" };
const FILTERS: readonly JobScanFilter[] = ["ALL", "UNMAPPED", "MAPPED"];

function readFacets(value: unknown): JobScanSearchFacets | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const { building, floor, storageFormat } = value as Record<string, unknown>;
  const facets: JobScanSearchFacets = {};
  if (typeof building === "string" && building.trim())
    facets.building = building.trim().slice(0, 200);
  if (typeof floor === "number" && Number.isSafeInteger(floor) && floor >= 0)
    facets.floor = floor;
  if (
    storageFormat === "PALLET" ||
    storageFormat === "BOX" ||
    storageFormat === "OTHER"
  )
    facets.storageFormat = storageFormat;
  return Object.keys(facets).length ? facets : undefined;
}

function read(value: unknown): JobScanRecordState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return initial;
  const state = value as Record<string, unknown>;
  const search =
    typeof state.search === "string" ? state.search.slice(0, 200) : "";
  const facets = readFacets(state.facets);
  const locationId =
    search.trim() &&
    typeof state.locationId === "string" &&
    /^[a-z0-9]+$/i.test(state.locationId) &&
    state.locationId.length <= 100
      ? state.locationId
      : undefined;
  return {
    filter: FILTERS.includes(state.filter as JobScanFilter)
      ? (state.filter as JobScanFilter)
      : initial.filter,
    search,
    ...(locationId
      ? { locationId }
      : search.trim() && state.exactCode === true
        ? { exactCode: true }
        : {}),
    ...(facets ? { facets } : {}),
  };
}

const codec = {
  decode(encoded: string | null) {
    try {
      return encoded ? read(JSON.parse(encoded)) : initial;
    } catch {
      return initial;
    }
  },
  encode: (state: JobScanRecordState) =>
    state.filter === initial.filter && !state.search && !state.facets
      ? null
      : JSON.stringify(state),
  readPreference: read,
  // Only the status view is remembered; a search is restored from history.
  writePreference: (state: JobScanRecordState) => ({ filter: state.filter }),
};
const options = {
  parameter: "scans",
  scopeField: "jobScanRecordsScope",
  event: "job-scan-records-state",
  codec,
};

/** Status and search live in the URL so Back, Forward and refresh restore them. */
export function useJobScanRecordState(viewKey: string) {
  return useCatalogueUrlState(viewKey, options);
}
