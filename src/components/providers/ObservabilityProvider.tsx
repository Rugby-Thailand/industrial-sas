"use client";

import { useMemo } from "react";

import {
  resolveObservabilityPort,
  type ObservabilityPort,
} from "@/lib/observability/port";

export function useObservability(): ObservabilityPort {
  return useMemo(
    () => resolveObservabilityPort(process.env.NEXT_PUBLIC_OBSERVABILITY_SINK),
    [],
  );
}
