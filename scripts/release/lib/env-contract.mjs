// Deployment environment contract (R5). Pure, dependency-free and tested in
// tests/integration/release-env-contract.integration.test.ts.
//
// The Vercel build command runs this twice, both times before Convex pushes
// any backend code:
//   pre   — before `convex deploy` starts (deploy key, target, provenance)
//   build — inside `convex deploy --cmd`, after Convex injected the URL it
//           will push to, still before the push itself.
// Problems name variables, never their values.

import { readFileSync } from "node:fs";

import {
  classifyConvexDeployKey,
  decodePublishableKey,
} from "./credential-shapes.mjs";

export { classifyConvexDeployKey, decodePublishableKey };

const SHA = /^[0-9a-f]{40}$/;
const RUN_ID = /^\d{1,20}$/;

export function loadTargets(
  path = new URL("../targets.json", import.meta.url),
) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const present = (env, name) => (env[name] ?? "").trim().length > 0;

export function selectTarget(env, targets) {
  const name = (env.RELEASE_ENVIRONMENT ?? "").trim();
  return Object.hasOwn(targets.targets, name)
    ? { name, target: targets.targets[name] }
    : null;
}

/**
 * @param {Record<string,string|undefined>} env
 * @param {"pre"|"build"} phase
 * @returns {{ ok: boolean, target?: string, problems: string[], notes: string[] }}
 */
export function validateBuildEnvironment(env, phase, targets = loadTargets()) {
  const problems = [];
  const notes = [];
  const selected = selectTarget(env, targets);
  if (selected === null) {
    return {
      ok: false,
      problems: [
        "RELEASE_ENVIRONMENT must name a reviewed target in scripts/release/targets.json",
      ],
      notes,
    };
  }
  const { name, target } = selected;

  // Only the gated release workflow sets these; a Git-triggered or manual
  // build therefore refuses before any backend mutation.
  if (!SHA.test(env.RELEASE_SHA ?? "")) problems.push("RELEASE_SHA");
  if (!RUN_ID.test(env.RELEASE_RUN_ID ?? "")) problems.push("RELEASE_RUN_ID");
  if (
    present(env, "VERCEL_GIT_COMMIT_SHA") &&
    env.VERCEL_GIT_COMMIT_SHA !== env.RELEASE_SHA
  ) {
    problems.push("VERCEL_GIT_COMMIT_SHA (does not match RELEASE_SHA)");
  }

  // Vercel platform identity: the build runs in the expected project/target.
  if (env.VERCEL !== "1") problems.push("VERCEL (not a Vercel build)");
  if (env.VERCEL_TARGET_ENV !== "production") {
    problems.push("VERCEL_TARGET_ENV (expected production target)");
  }
  if (env.VERCEL_PROJECT_ID !== target.vercelProjectId) {
    problems.push(`VERCEL_PROJECT_ID (not the ${name} project)`);
  }

  // Developer deployment selection must never reach a release build.
  if (present(env, "CONVEX_DEPLOYMENT")) {
    problems.push("CONVEX_DEPLOYMENT (developer selection must be unset)");
  }
  const key = classifyConvexDeployKey(env.CONVEX_DEPLOY_KEY);
  if (key.kind !== "deployment") {
    problems.push(
      `CONVEX_DEPLOY_KEY (expected a ${target.convexDeployKeyClass} deployment key)`,
    );
  } else if (
    key.keyClass !== target.convexDeployKeyClass ||
    key.deployment !== target.convexDeployment
  ) {
    problems.push(`CONVEX_DEPLOY_KEY (not the ${name} Convex deployment)`);
  }
  for (const variable of [
    "CONVEX_ADMIN_KEY",
    "CONVEX_BACKUP_ADMIN_KEY",
    "CONVEX_SELF_HOSTED_URL",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
  ]) {
    if (present(env, variable)) {
      problems.push(
        `${variable} (operator or self-hosted selection must be unset)`,
      );
    }
  }

  const publishable = decodePublishableKey(
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  if (publishable === null) {
    problems.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  } else {
    if (publishable.keyClass !== target.clerkKeyClass) {
      problems.push(
        `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (expected ${target.clerkKeyClass} instance)`,
      );
    }
    if (publishable.frontendHost !== target.clerkFrontendHost) {
      problems.push(
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (unexpected Clerk frontend host)",
      );
    }
  }
  const secret = /^sk_(live|test)_\S+$/.exec(env.CLERK_SECRET_KEY ?? "");
  if (!secret) problems.push("CLERK_SECRET_KEY");
  else if (secret[1] !== target.clerkKeyClass) {
    problems.push(
      `CLERK_SECRET_KEY (expected ${target.clerkKeyClass} instance)`,
    );
  }
  if (env.CLERK_JWT_ISSUER_DOMAIN !== `https://${target.clerkFrontendHost}`) {
    problems.push("CLERK_JWT_ISSUER_DOMAIN (not the reviewed Clerk issuer)");
  }

  if (env.NEXT_PUBLIC_APP_URL !== target.appUrl) {
    problems.push("NEXT_PUBLIC_APP_URL (not the reviewed application URL)");
  }
  if (!/^\/(th|en)\/sign-in$/.test(env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "")) {
    problems.push("NEXT_PUBLIC_CLERK_SIGN_IN_URL");
  }
  const siteUrl = `https://${target.convexDeployment}.convex.site`;
  if (env.NEXT_PUBLIC_CONVEX_SITE_URL !== siteUrl) {
    problems.push("NEXT_PUBLIC_CONVEX_SITE_URL (not the target deployment)");
  }

  if (phase === "build") {
    // Injected by `convex deploy --cmd-url-env-var-name` from the deploy key.
    const cloudUrl = `https://${target.convexDeployment}.convex.cloud`;
    if (env.NEXT_PUBLIC_CONVEX_URL !== cloudUrl) {
      problems.push("NEXT_PUBLIC_CONVEX_URL (not the target deployment)");
    }
  } else if (phase !== "pre") {
    problems.push("phase (expected pre or build)");
  }

  // Optional integrations: report presence by name, never require them.
  for (const optional of [
    "UPLOADTHING_TOKEN",
    "NEXT_PUBLIC_OBSERVABILITY_SINK",
  ]) {
    notes.push(`${optional}: ${present(env, optional) ? "set" : "not set"}`);
  }

  return { ok: problems.length === 0, target: name, problems, notes };
}
