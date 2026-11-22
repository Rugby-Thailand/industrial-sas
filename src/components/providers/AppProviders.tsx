"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";

import type { AppEnvironment } from "@/lib/environment";

import { AiUsageAccessProvider } from "./AiUsageAccessProvider";
import { CustomerNavigationAccessProvider } from "./CustomerNavigationAccessProvider";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { EnvironmentProvider, useAppEnvironment } from "./EnvironmentProvider";
import { IdentityProvider } from "./IdentityProvider";
import { HrAccessProvider } from "./HrAccessProvider";
import { isHomePath } from "./isHomePath";
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
  // Home authorizes its cross-module data independently of shell access reads.
  const allowPartialAccess = isHomePath(usePathname());
  return environment.backendConfigured && environment.identityConfigured ? (
    <WorkspaceProvider>
      <HrAccessProvider allowPartialAccess={allowPartialAccess}>
        <AiUsageAccessProvider allowPartialAccess={allowPartialAccess}>
          <CustomerNavigationAccessProvider>
            {children}
          </CustomerNavigationAccessProvider>
        </AiUsageAccessProvider>
      </HrAccessProvider>
    </WorkspaceProvider>
  ) : (
    <UnavailableWorkspaceProvider
      reason={
        environment.backendConfigured ? "SIGN_IN_REQUIRED" : "BACKEND_MISSING"
      }
    >
      {children}
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

export function AppProviders({
  children,
  environment,
}: {
  readonly children: ReactNode;
  readonly environment: AppEnvironment;
}) {
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
      <EnvironmentProvider environment={environment}>
        <IdentityProvider>
          <ConvexClientProvider>
            <EnvironmentAwareWorkspaceProvider>
              {children}
            </EnvironmentAwareWorkspaceProvider>
          </ConvexClientProvider>
        </IdentityProvider>
      </EnvironmentProvider>
    </ThemeProvider>
  );
}
