import { resolveClerkPublishableKey } from "./clerkConfiguration";

export interface PublicEnvironment {
  readonly convexUrl?: string | undefined;
  readonly clerkPublishableKey?: string | undefined;
}

export interface AppEnvironment {
  readonly backendConfigured: boolean;

  readonly convexUrl?: string;

  readonly identityConfigured: boolean;
}

const present = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export function resolveAppEnvironment(
  environment: PublicEnvironment,
): AppEnvironment {
  const convexUrl = present(environment.convexUrl);
  const identityConfigured =
    resolveClerkPublishableKey(environment.clerkPublishableKey) !== undefined;
  return Object.freeze({
    backendConfigured: convexUrl !== undefined,
    ...(convexUrl === undefined ? {} : { convexUrl }),
    identityConfigured,
  });
}

export function currentAppEnvironment(): AppEnvironment {
  return resolveAppEnvironment({
    convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
    clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });
}
