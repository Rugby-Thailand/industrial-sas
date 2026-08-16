"use client";

/**
 * Mount Clerk only when this environment has a real publishable key.
 *
 * Keeping the unconfigured branch is intentional: contributors can still run
 * the setup gate and synthetic preview without creating a Clerk account, while
 * a configured development environment gets the exact provider hierarchy Clerk
 * and Convex require. The key is public by definition; no server secret crosses
 * this client boundary.
 */
import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { resolveClerkPublishableKey } from "@/lib/clerkConfiguration";

import { useAppEnvironment } from "./EnvironmentProvider";

export function IdentityProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const environment = useAppEnvironment();
  const publishableKey = resolveClerkPublishableKey(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );

  if (!environment.identityConfigured || !publishableKey)
    return <>{children}</>;

  return (
    <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>
  );
}
