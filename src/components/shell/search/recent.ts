import { useAuth } from "@clerk/nextjs";
import { useMemo } from "react";

import { preferences } from "@/lib/browser/storage";
import {
  STATIC_DESTINATIONS,
  type DestinationTarget,
  type StaticDestinationKey,
} from "@/lib/navigation";

const LIMIT = 5;
const KNOWN: ReadonlySet<string> = new Set(
  STATIC_DESTINATIONS.map((destination) => destination.key),
);

/**
 * Where one member's recent destinations are kept in one organization, or
 * null before both are known. Only registry keys are stored: no record IDs,
 * names or typed text.
 */
export function recentStorageKey(
  userId: string | null | undefined,
  orgId: string | null | undefined,
): string | null {
  return userId && orgId
    ? ["search-recent", orgId, userId].map(encodeURIComponent).join(":")
    : null;
}

/** A record destination is remembered as the page it opens on. */
function pageOf(target: DestinationTarget): StaticDestinationKey {
  switch (target.key) {
    case "hr.selfDay":
      return "hr.time";
    case "hr.reviewDay":
      return "hr.review";
    case "hr.employeeEdit":
      return "hr.employees";
    case "hr.period":
      return "hr.periods";
    default:
      return target.key;
  }
}

const decode = (value: unknown): readonly StaticDestinationKey[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (key): key is StaticDestinationKey =>
              typeof key === "string" && KNOWN.has(key),
          ),
        ),
      ].slice(0, LIMIT)
    : [];

/** Newest first; unreadable or unavailable storage reads as none. */
export function readRecent(
  storageKey: string | null,
): readonly StaticDestinationKey[] {
  return storageKey === null ? [] : preferences.read(storageKey, decode, []);
}

/** Puts a destination first; a failed write is ignored. */
export function rememberRecent(
  storageKey: string | null,
  target: DestinationTarget,
): void {
  if (storageKey === null) return;
  const page = pageOf(target);
  preferences.write(
    storageKey,
    [page, ...readRecent(storageKey).filter((key) => key !== page)].slice(
      0,
      LIMIT,
    ),
  );
}

/** The signed-in member's recent destinations, read when search opens. */
export function useRecentDestinations(): readonly StaticDestinationKey[] {
  const { userId, orgId } = useAuth();
  return useMemo(
    () => readRecent(recentStorageKey(userId, orgId)),
    [userId, orgId],
  );
}
