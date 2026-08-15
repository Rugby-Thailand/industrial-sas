"use client";

/**
 * The client-side provider stack, in dependency order.
 *
 * Environment first — the Convex client and the workspace both read it.
 * Observability next, so anything below can report without threading a port
 * through props. Convex after that, so any screen below may issue a query.
 * Workspace last, because a warehouse choice only means anything once there is
 * something to scope.
 */
import type { ReactNode } from "react";

import { ConvexClientProvider } from "./ConvexClientProvider";
import { EnvironmentProvider } from "./EnvironmentProvider";
import { IdentityProvider } from "./IdentityProvider";
import { ObservabilityProvider } from "./ObservabilityProvider";
import { WorkspaceProvider } from "./WorkspaceProvider";

export function AppProviders({ children }: { readonly children: ReactNode }) {
  return (
    <EnvironmentProvider>
      <ObservabilityProvider>
        <IdentityProvider>
          <ConvexClientProvider>
            <WorkspaceProvider>{children}</WorkspaceProvider>
          </ConvexClientProvider>
        </IdentityProvider>
      </ObservabilityProvider>
    </EnvironmentProvider>
  );
}
