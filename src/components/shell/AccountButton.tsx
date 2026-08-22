"use client";

import { UserButton } from "@clerk/nextjs";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { resolveClerkPublishableKey } from "@/lib/clerkConfiguration";

/** The authenticated account menu. Hidden only in unconfigured test/setup UI. */
export function AccountButton() {
  const environment = useAppEnvironment();
  const publishableKey = resolveClerkPublishableKey(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );

  if (!environment.identityConfigured || !publishableKey) return null;

  return <UserButton appearance={{ elements: { avatarBox: "size-9" } }} />;
}
