"use client";

import { useCatalogueUrlState } from "@/hooks/useCatalogueUrlState";

export type JobScanFilter = "ALL" | "UNMAPPED" | "MAPPED";
export type JobScanRecordState = { filter: JobScanFilter; search: string };

const initial: JobScanRecordState = { filter: "UNMAPPED", search: "" };
const FILTERS: readonly JobScanFilter[] = ["ALL", "UNMAPPED", "MAPPED"];

function read(value: unknown): JobScanRecordState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return initial;
  const state = value as Record<string, unknown>;
  return {
    filter: FILTERS.includes(state.filter as JobScanFilter)
      ? (state.filter as JobScanFilter)
      : initial.filter,
    search: typeof state.search === "string" ? state.search.slice(0, 200) : "",
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
    state.filter === initial.filter && !state.search
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
