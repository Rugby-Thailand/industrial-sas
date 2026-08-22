/**
 * What this deployment is actually configured to do — resolved once, from the
 * public environment, as a pure function of it.
 *
 * Three questions have to be answerable before any screen renders, and answered
 * the same way by every screen:
 *
 * 1. **Is there a backend?** `NEXT_PUBLIC_CONVEX_URL`. Without it there is no
 *    Convex client, so no ledger read can be attempted and saying "loading"
 *    would be a lie.
 * 2. **Is there an identity provider?** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
 *    Without it `ctx.auth.getUserIdentity()` is `null` in every Convex function,
 *    every tenant-bound wrapper denies, and the honest screen is a setup gate
 *    rather than a spinner followed by a denial (`ADR-0001` §2, `INV-0001-02`).
 */

import { resolveClerkPublishableKey } from "./clerkConfiguration";

/** The subset of `process.env` this module reads. */
export interface PublicEnvironment {
  readonly convexUrl?: string | undefined;
  readonly clerkPublishableKey?: string | undefined;
}

export interface AppEnvironment {
  /** A Convex deployment URL is configured, so a client can be constructed. */
  readonly backendConfigured: boolean;
  /** The configured deployment URL, present only when `backendConfigured`. */
  readonly convexUrl?: string;
  /** An identity provider is configured, so a verified token is obtainable. */
  readonly identityConfigured: boolean;
}

/** A trimmed, non-empty value, or `undefined`. Whitespace is not configuration. */
const present = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/**
 * Classify an environment. Total, pure, and the only place these rules live.
 *
 * Taking the environment as an argument rather than reading `process.env`
 * keeps configuration rules deterministic and easy to test.
 */
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

/**
 * The environment of the running application.
 *
 * The `process.env.NEXT_PUBLIC_*` members are spelled out literally because
 * Next.js inlines them by exact textual match; `process.env[name]` with a
 * computed name is `undefined` in the browser bundle, silently.
 */
export function currentAppEnvironment(): AppEnvironment {
  return resolveAppEnvironment({
    convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
    clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });
}
