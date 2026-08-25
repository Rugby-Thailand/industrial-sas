import { auth } from "@clerk/nextjs/server";

import { resolveClerkPublishableKey } from "@/lib/clerkConfiguration";

export type AppAccess = "SIGN_IN" | "ORGANIZATION_REQUIRED" | "APP";

export function resolveAppAccess(input: {
  readonly identityConfigured: boolean;
  readonly userId: string | undefined;
  readonly orgId: string | undefined;
}): AppAccess {
  if (!input.identityConfigured || input.userId === undefined) return "SIGN_IN";
  return input.orgId === undefined ? "ORGANIZATION_REQUIRED" : "APP";
}

export async function readAppAccess(): Promise<AppAccess> {
  const identityConfigured =
    resolveClerkPublishableKey(
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    ) !== undefined && Boolean(process.env.CLERK_SECRET_KEY?.trim());

  if (!identityConfigured) {
    return resolveAppAccess({
      identityConfigured: false,
      userId: undefined,
      orgId: undefined,
    });
  }

  const session = await auth();
  return resolveAppAccess({
    identityConfigured: true,
    userId: session.userId ?? undefined,
    orgId: session.orgId ?? undefined,
  });
}
