"use client";

import { useSyncExternalStore, type ReactNode } from "react";
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

const subscribe = () => () => {};
/**
 * The theme script runs only from the server's HTML, before first paint. React
 * never executes a script it renders on the client (for example when a
 * language switch remounts this provider), so that copy is an inert data block.
 */
const INERT_SCRIPT = { type: "text/plain" } as const;
const clientScriptProps = () => INERT_SCRIPT;
const serverScriptProps = () => undefined;

export function AppProviders({ children }: { readonly children: ReactNode }) {
  // Hydration uses the server value, so the server's script is adopted as is.
  const scriptProps = useSyncExternalStore(
    subscribe,
    clientScriptProps,
    serverScriptProps,
  );
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...(scriptProps === undefined ? {} : { scriptProps })}
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
