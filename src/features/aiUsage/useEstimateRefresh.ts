"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  ESTIMATE_REVALIDATE_SECONDS,
  type UsageEstimate,
} from "@/lib/aiUsage/estimateSources";

const RETRY_MS = 10 * 60_000;

/** Re-read the server snapshot when a report stays open across a daily refresh. */
export function useEstimateRefresh(estimate: UsageEstimate | undefined) {
  const { refresh } = useRouter();
  const lastRequest = useRef(0);
  useEffect(() => {
    if (!estimate) return;
    const due = Math.min(
      ...[estimate.fx, estimate.funding].map((source) =>
        source.status === "UNAVAILABLE"
          ? estimate.loadedAt + RETRY_MS
          : source.value.fetchedAt + ESTIMATE_REVALIDATE_SECONDS * 1000,
      ),
    );
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const now = Date.now();
      if (now >= due && now >= lastRequest.current + RETRY_MS) {
        lastRequest.current = now;
        // Refresh preserves filters and scroll; persistent source caches still
        // enforce the daily window and retain last good data during revalidation.
        refresh();
      }
      timer = setTimeout(
        check,
        Math.min(
          3_600_000,
          Math.max(1000, due - now, lastRequest.current + RETRY_MS - now),
        ),
      );
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
    };
  }, [estimate, refresh]);
}
