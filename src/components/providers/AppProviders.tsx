"use client";

import type { ReactNode } from "react";

import { ConvexClientProvider } from "./ConvexClientProvider";
import { EnvironmentProvider } from "./EnvironmentProvider";
import { IdentityProvider } from "./IdentityProvider";
import { ObservabilityProvider } from "./ObservabilityProvider";

export function AppProviders({ children }: { readonly children: ReactNode }) {
  return (
    <EnvironmentProvider>
      <ObservabilityProvider>
        <IdentityProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </IdentityProvider>
      </ObservabilityProvider>
    </EnvironmentProvider>
  );
}
