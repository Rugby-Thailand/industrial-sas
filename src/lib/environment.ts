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
 * 3. **Is local preview data on?** See below.
 *
 * ### Why preview mode cannot reach production
 *
 * Preview mode renders synthetic rows through the real screens so the layout,
 * the Thai copy, and the formatters can be evaluated without vendor credentials.
 * That is useful and it is also exactly the kind of switch that ends up on in
 * production, so it is gated twice and one of the gates is not an environment
 * variable at all:
 *
 * - `NEXT_PUBLIC_LOCAL_PREVIEW` must be exactly `"1"`. An explicit opt-in, not a
 *   truthiness test — `"0"`, `"false"`, and `"no"` are all off.
 * - `NODE_ENV` must not be `"production"`. Next.js **statically replaces**
 *   `process.env.NODE_ENV` in the client bundle at build time, so in anything
 *   produced by `next build` this comparison is `"production" !== "production"`
 *   and no runtime value of any variable can make it true.
 *
 * The consequence is deliberate and worth stating plainly: preview mode works
 * under `next dev` and nowhere else.
 *
 * What is *not* claimed: that the fixture disappears from the bundle. The
 * preview module is imported statically by the workspace resolver, so its rows
 * are still shipped as unreachable code in a production build — verifiable with
 * `grep -r prv_wh_bangpoo .next/static`. That is why nothing in the fixture is
 * sensitive and every identifier in it carries a `prv_` prefix: an unreachable
 * synthetic row is harmless, and a leaked one is obvious.
 */

/** The subset of `process.env` this module reads. */
export interface PublicEnvironment {
  readonly convexUrl?: string | undefined;
  readonly clerkPublishableKey?: string | undefined;
  readonly localPreviewFlag?: string | undefined;
  readonly nodeEnv?: string | undefined;
}

/** Where the data on screen comes from. There is no third possibility. */
export type DataSourceMode = "SERVER" | "LOCAL_PREVIEW";

export interface AppEnvironment {
  /** A Convex deployment URL is configured, so a client can be constructed. */
  readonly backendConfigured: boolean;
  /** The configured deployment URL, present only when `backendConfigured`. */
  readonly convexUrl?: string;
  /** An identity provider is configured, so a verified token is obtainable. */
  readonly identityConfigured: boolean;
  /** Synthetic local data is in use. Implies `!identityConfigured` is tolerable. */
  readonly previewMode: boolean;
  readonly dataSource: DataSourceMode;
}

const OPT_IN = "1";

/** A trimmed, non-empty value, or `undefined`. Whitespace is not configuration. */
const present = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/**
 * Classify an environment. Total, pure, and the only place these rules live.
 *
 * Taking the environment as an argument rather than reading `process.env` is
 * what makes "preview mode is impossible in production" a testable claim instead
 * of a comment: the test can construct the production case directly.
 */
export function resolveAppEnvironment(
  environment: PublicEnvironment,
): AppEnvironment {
  const convexUrl = present(environment.convexUrl);
  const identityConfigured =
    present(environment.clerkPublishableKey) !== undefined;
  const previewMode =
    environment.nodeEnv !== "production" &&
    present(environment.localPreviewFlag) === OPT_IN;

  return Object.freeze({
    backendConfigured: convexUrl !== undefined,
    ...(convexUrl === undefined ? {} : { convexUrl }),
    identityConfigured,
    previewMode,
    dataSource: previewMode ? ("LOCAL_PREVIEW" as const) : ("SERVER" as const),
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
    localPreviewFlag: process.env.NEXT_PUBLIC_LOCAL_PREVIEW,
    nodeEnv: process.env.NODE_ENV,
  });
}
