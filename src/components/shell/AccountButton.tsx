"use client";

import { UserButton } from "@clerk/nextjs";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { resolveClerkPublishableKey } from "@/lib/clerkConfiguration";

export function AccountButton() {
  const environment = useAppEnvironment();
  const publishableKey = resolveClerkPublishableKey(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );

  if (!environment.identityConfigured || !publishableKey) return null;

  return <UserButton appearance={{ elements: { avatarBox: "size-9" } }} />;
}
