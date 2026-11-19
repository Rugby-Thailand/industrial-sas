"use client";

import { useCatalogueUrlState } from "@/hooks/useCatalogueUrlState";

export type CustomerStatusFilter = "ACTIVE" | "ARCHIVED" | "ALL";

export interface CustomerCatalogueState {
  search: string;
  status: CustomerStatusFilter;
}

/** Active customers first: archived ones stay one filter away (plan: List). */
const initial: CustomerCatalogueState = { search: "", status: "ACTIVE" };

function read(value: unknown): CustomerCatalogueState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return initial;
  const state = value as Record<string, unknown>;
  return typeof state.search === "string" &&
    (state.status === "ACTIVE" ||
      state.status === "ARCHIVED" ||
      state.status === "ALL")
    ? { search: state.search, status: state.status }
    : initial;
}

const options = {
  parameter: "customers",
  scopeField: "customerCatalogueScope",
  event: "customer-catalogue-state",
  codec: {
    decode(encoded: string | null) {
      try {
        return encoded ? read(JSON.parse(encoded)) : initial;
      } catch {
        return initial;
      }
    },
    encode: (state: CustomerCatalogueState) => JSON.stringify(state),
    readPreference: read,
    writePreference: (state: CustomerCatalogueState) => state,
  },
};

/** Search and status live in the URL, so Back to the list restores them. */
export function useCustomerCatalogueState(scope: string) {
  return useCatalogueUrlState(scope, options);
}
