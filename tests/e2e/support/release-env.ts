import { readFileSync } from "node:fs";

import { decodePublishableKey } from "../../../scripts/release/lib/credential-shapes.mjs";

/**
 * Inputs for the release smoke suites, read lazily so `playwright --list`
 * (test discovery) works without any environment. Missing required inputs
 * fail the run; they are never treated as a skip.
 */

interface Target {
  readonly appUrl: string;
  readonly convexDeployment: string;
  readonly clerkKeyClass: "live" | "test";
  readonly clerkFrontendHost: string;
  readonly candidateUrl?: string;
}

export function releaseTarget(): {
  readonly name: string;
  readonly target: Target;
} {
  const name = process.env.SMOKE_TARGET ?? "";
  const targets = JSON.parse(
    readFileSync("scripts/release/targets.json", "utf8"),
  ).targets as Record<string, Target>;
  const target = targets[name];
  if (!target) throw new Error("SMOKE_TARGET must be production or staging");
  return { name, target };
}

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for this suite`);
  return value;
}

/** Owned origins come from the reviewed target file, never a caller allowlist. */
export function isOwnedIdentityHost(baseUrl: string, appUrl: string): boolean {
  const targets = JSON.parse(
    readFileSync("scripts/release/targets.json", "utf8"),
  ).targets as Record<string, Target>;
  const reviewed = Object.values(targets).find(
    (target) => target.appUrl === appUrl,
  );
  if (!reviewed) return false;
  const base = new URL(baseUrl);
  if (base.username || base.password) return false;
  return [reviewed.appUrl, reviewed.candidateUrl].some(
    (url) => url && new URL(url).origin === base.origin,
  );
}

/** Missing or mismatched release inputs fail; candidate widget checks cannot skip. */
export function releaseSmokeInputs() {
  const { name, target } = releaseTarget();
  const baseUrl = required("SMOKE_BASE_URL");
  const expectedSha = required("SMOKE_EXPECTED_SHA");
  if (!/^[a-f0-9]{40}$/.test(expectedSha))
    throw new Error("SMOKE_EXPECTED_SHA is invalid");
  const phase = required("SMOKE_PHASE");
  const expectedUrl =
    name === "staging" && phase === "staging"
      ? target.appUrl
      : name === "production" && phase === "live"
        ? target.appUrl
        : name === "production" && phase === "candidate"
          ? target.candidateUrl
          : undefined;
  if (
    !expectedUrl ||
    !isOwnedIdentityHost(baseUrl, target.appUrl) ||
    new URL(baseUrl).origin !== new URL(expectedUrl).origin
  )
    throw new Error(
      "SMOKE_BASE_URL/SMOKE_PHASE must match the reviewed release target",
    );
  return { name, target, baseUrl, expectedSha };
}

/** Keep queries such as Next's ?dpl= while refusing cross-origin script URLs. */
export function clientScriptUrls(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const urls = new Set<string>();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const url = new URL(match[1]!.replaceAll("&amp;", "&"), base);
    if (
      url.origin === base.origin &&
      url.pathname.startsWith("/_next/static/") &&
      url.pathname.endsWith(".js")
    )
      urls.add(url.href);
  }
  if (urls.size === 0 || urls.size > 60)
    throw new Error("SMOKE_CLIENT_CHUNK_INVENTORY_INVALID");
  return [...urls];
}

/** Decode semantic identity configuration; Clerk may omit Base64 padding. */
export function clientIdentityConfiguration(
  bundle: string,
  target: Pick<Target, "clerkKeyClass" | "clerkFrontendHost">,
) {
  const keys = (bundle.match(/\bpk_(?:test|live)_[A-Za-z0-9+/=_-]+/g) ?? [])
    .map(decodePublishableKey)
    .filter((key) => key !== null);
  const matches = (key: (typeof keys)[number]) =>
    key.keyClass === target.clerkKeyClass &&
    key.frontendHost === target.clerkFrontendHost;
  // Expose only verdicts so assertion errors cannot copy a chunk/key value.
  return {
    hasExpectedIdentityKey: keys.some(matches),
    hasForeignIdentityKey: keys.some((key) => !matches(key)),
  };
}
