"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";

import {
  AiUsageAccessProvider,
  UnavailableAiUsageAccessProvider,
} from "./AiUsageAccessProvider";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { EnvironmentProvider, useAppEnvironment } from "./EnvironmentProvider";
import { IdentityProvider } from "./IdentityProvider";
import {
  HrAccessProvider,
  UnavailableHrAccessProvider,
} from "./HrAccessProvider";
import { ObservabilityProvider } from "./ObservabilityProvider";
import {
  UnavailableWorkspaceProvider,
  WorkspaceProvider,
} from "./WorkspaceProvider";

export function EnvironmentAwareWorkspaceProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const environment = useAppEnvironment();
  return environment.backendConfigured && environment.identityConfigured ? (
    <WorkspaceProvider>
      <HrAccessProvider>
        <AiUsageAccessProvider>{children}</AiUsageAccessProvider>
      </HrAccessProvider>
    </WorkspaceProvider>
  ) : (
    <UnavailableWorkspaceProvider
      reason={
        environment.backendConfigured ? "SIGN_IN_REQUIRED" : "BACKEND_MISSING"
      }
    >
      <UnavailableHrAccessProvider>
        <UnavailableAiUsageAccessProvider>
          {children}
        </UnavailableAiUsageAccessProvider>
      </UnavailableHrAccessProvider>
    </UnavailableWorkspaceProvider>
  );
}

export function AppProviders({ children }: { readonly children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <EnvironmentProvider>
        <ObservabilityProvider>
          <IdentityProvider>
            <ConvexClientProvider>
              <EnvironmentAwareWorkspaceProvider>
                {children}
              </EnvironmentAwareWorkspaceProvider>
            </ConvexClientProvider>
          </IdentityProvider>
        </ObservabilityProvider>
      </EnvironmentProvider>
    </ThemeProvider>
  );
}
