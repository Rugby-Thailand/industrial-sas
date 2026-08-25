"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  resolveObservabilityPort,
  type ObservabilityPort,
} from "@/lib/observability/port";

const ObservabilityContext = createContext<ObservabilityPort | undefined>(
  undefined,
);

export function ObservabilityProvider({
  children,
  port,
}: {
  readonly children: ReactNode;

  readonly port?: ObservabilityPort;
}) {
  const resolved = useMemo(
    () =>
      port ??
      resolveObservabilityPort(process.env.NEXT_PUBLIC_OBSERVABILITY_SINK),
    [port],
  );

  return (
    <ObservabilityContext.Provider value={resolved}>
      {children}
    </ObservabilityContext.Provider>
  );
}

export function useObservability(): ObservabilityPort {
  const provided = useContext(ObservabilityContext);
  const fallback = useMemo(
    () => resolveObservabilityPort(process.env.NEXT_PUBLIC_OBSERVABILITY_SINK),
    [],
  );
  return provided ?? fallback;
}
