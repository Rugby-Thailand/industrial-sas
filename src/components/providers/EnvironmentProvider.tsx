"use client";

/**
 * The resolved environment, shared by every screen.
 *
 * A context rather than a call to `currentAppEnvironment()` at each use site for
 * one reason: tests. `resolveAppEnvironment` is pure and already covered on its
 * own, but a component that reads `process.env` directly can only be tested in
 * whatever environment the test runner happens to have. With a provider, a test
 * renders the "no backend" screen without reading process globals in a component.
 *
 * The default value is the real environment, so a component mounted without a
 * provider — which is every screen in the running application — behaves exactly
 * as it would have without the context.
 */
import { createContext, useContext, type ReactNode } from "react";

import { currentAppEnvironment, type AppEnvironment } from "@/lib/environment";

const EnvironmentContext = createContext<AppEnvironment | undefined>(undefined);

export function EnvironmentProvider({
  children,
  environment,
}: {
  readonly children: ReactNode;
  /** Test seam. Omitted in the application, where the real one is resolved. */
  readonly environment?: AppEnvironment;
}) {
  return (
    <EnvironmentContext.Provider value={environment ?? currentAppEnvironment()}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useAppEnvironment(): AppEnvironment {
  return useContext(EnvironmentContext) ?? currentAppEnvironment();
}
