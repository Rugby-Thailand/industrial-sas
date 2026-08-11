"use client";

/**
 * The observability sink, resolved once and shared.
 *
 * A context rather than a module singleton so a test can supply a recording
 * port and assert what a screen emitted — which is the only way to prove that
 * a denial produces a `warning` and not an `error`, and that no dimension
 * carries a tenant's data.
 *
 * The default is the sink named by `NEXT_PUBLIC_OBSERVABILITY_SINK`, which is
 * `none` unless someone chose otherwise.
 */
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
  /** Test seam. Omitted in the application. */
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
