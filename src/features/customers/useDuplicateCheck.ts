"use client";

import { useConvex, useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import { useDebouncedSearch } from "@/hooks/useScanContinuation";
import type { SimilarCustomer } from "./customerTypes";

type SimilarAnswer = FunctionReturnType<
  typeof api.customers.catalogue.findSimilarCustomers
>;

export type DuplicateLookup =
  | { readonly kind: "failed" }
  | { readonly kind: "found"; readonly matches: readonly SimilarCustomer[] }
  | { readonly kind: "clear" };

/**
 * Likely duplicates for the name being typed, from two sources under one
 * precedence rule: the live hint for the current name wins (an empty answer
 * included); a Save-time answer only stands in until it arrives, and is
 * retired for good by a live answer or by editing the name. Rendering and
 * Save both read `matches` and `answered`, so they can never disagree.
 */
export function useDuplicateCheck(enabled: boolean, name: string) {
  const convex = useConvex();
  const settledName = useDebouncedSearch(name, 400);
  const currentName = name.trim();
  // The live hint answers with an Error instead of throwing: a failed hint
  // must not take the form, and its draft, down with it.
  const hint = useQueries(
    enabled && settledName.trim() !== ""
      ? {
          similar: {
            query: api.customers.catalogue.findSimilarCustomers,
            args: { name: settledName },
          },
        }
      : {},
  ).similar as SimilarAnswer | Error | undefined;
  const similar = hint instanceof Error ? undefined : hint;
  const liveMatches =
    settledName.trim() === currentName && similar?.ok
      ? similar.value
      : undefined;
  const [saved, setSaved] = useState<{
    readonly name: string;
    readonly matches: readonly SimilarCustomer[];
  }>();
  if (liveMatches !== undefined && saved !== undefined) setSaved(undefined);
  const savedMatches =
    liveMatches === undefined && saved?.name === currentName
      ? saved.matches
      : undefined;
  return {
    /** What to show, and what counts as reviewed for the current name. */
    matches: liveMatches ?? savedMatches ?? [],
    /** The current name has an answer the person can see. */
    answered: liveMatches !== undefined || savedMatches !== undefined,
    /**
     * A one-off check for Save. The client can answer synchronously from a
     * cached failure, so a throw and a rejection both mean "failed".
     */
    async lookup(forName: string): Promise<DuplicateLookup> {
      let found: SimilarAnswer | undefined;
      try {
        found = await convex.query(
          api.customers.catalogue.findSimilarCustomers,
          { name: forName },
        );
      } catch {
        found = undefined;
      }
      if (!found?.ok) return { kind: "failed" };
      return found.value.length > 0
        ? { kind: "found", matches: found.value }
        : { kind: "clear" };
    },
    /** Shows a Save-time answer for this exact name until superseded. */
    remember(forName: string, matches: readonly SimilarCustomer[]) {
      setSaved({ name: forName, matches });
    },
    /** Retires the Save-time answer (the name changed). */
    forget() {
      setSaved(undefined);
    },
  };
}
