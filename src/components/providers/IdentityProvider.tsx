"use client";

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
