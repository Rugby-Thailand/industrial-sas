"use client";

import { useCallback, useSyncExternalStore } from "react";

import { toLocal } from "../../../convex/model/hr/calendar";

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;
/** Fire just after the boundary so the new date is already current. */
const BOUNDARY_MARGIN_MS = 250;

/** The organization-local business date of an instant. */
export function businessDateAt(now: number, offsetMinutes: number): string {
  return toLocal(now, offsetMinutes).date;
}

/** Milliseconds from `now` until the next organization-local midnight. */
export function msUntilNextBusinessDate(
  now: number,
  offsetMinutes: number,
): number {
  const local = now + offsetMinutes * MS_PER_MINUTE;
  const intoDay = ((local % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  return MS_PER_DAY - intoDay;
}

const serverSnapshot = () => undefined;

/**
 * The organization's current business date for display, derived on the
 * client from the organization's fixed UTC offset, so the shared HR access
 * query need not read the server clock. It re-renders at local midnight and
 * re-checks when the tab becomes visible or focused again (timers in a
 * background tab may be delayed). Display only: every HR write and lock
 * decides the date with the server clock.
 */
export function useBusinessDate(
  offsetMinutes: number | undefined,
): string | undefined {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (offsetMinutes === undefined) return () => {};
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(
          () => {
            notify();
            arm();
          },
          msUntilNextBusinessDate(Date.now(), offsetMinutes) +
            BOUNDARY_MARGIN_MS,
        );
      };
      const recheck = () => {
        notify();
        arm();
      };
      arm();
      document.addEventListener("visibilitychange", recheck);
      window.addEventListener("focus", recheck);
      window.addEventListener("pageshow", recheck);
      return () => {
        if (timer !== undefined) clearTimeout(timer);
        document.removeEventListener("visibilitychange", recheck);
        window.removeEventListener("focus", recheck);
        window.removeEventListener("pageshow", recheck);
      };
    },
    [offsetMinutes],
  );
  const snapshot = useCallback(
    () =>
      offsetMinutes === undefined
        ? undefined
        : businessDateAt(Date.now(), offsetMinutes),
    [offsetMinutes],
  );
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
