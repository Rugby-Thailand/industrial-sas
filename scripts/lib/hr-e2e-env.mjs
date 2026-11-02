import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export const HR_TEST_IDENTITY = Object.freeze({
  email: "local.tester@example.com",
  userId: "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd",
  organizationId: "org_3JXrDUraQjTRO3hcIzMGC9CvIXV",
});

/** Fail closed before Clerk tickets, seeding, or starting a service. */
export function assertHrEnvironment(env) {
  const refuse = (name) => {
    throw new Error(`HR_E2E_UNSAFE_ENVIRONMENT: ${name}`);
  };
  for (const name of [
    "CONVEX_DEPLOY_KEY",
    "CONVEX_ADMIN_KEY",
    "CONVEX_SELF_HOSTED_URL",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
    "CLERK_API_URL",
  ]) {
    if (env[name]) refuse(name);
  }
  if (!/^anonymous:anonymous-[a-z0-9-]+$/.test(env.CONVEX_DEPLOYMENT ?? ""))
    refuse("CONVEX_DEPLOYMENT");
  for (const [name, expected] of [
    ["NEXT_PUBLIC_APP_URL", "http://localhost:3110"],
    ["NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3320"],
    ["NEXT_PUBLIC_CONVEX_SITE_URL", "http://127.0.0.1:3321"],
  ]) {
    if (env[name] !== expected) refuse(name);
  }
  if (env.ALLOW_LOCAL_TEST_SEED !== "true") refuse("ALLOW_LOCAL_TEST_SEED");
  if (!/^sk_test_[A-Za-z0-9_-]+$/.test(env.CLERK_SECRET_KEY ?? ""))
    refuse("CLERK_SECRET_KEY");
  if (
    !/^pk_test_[A-Za-z0-9_-]+$/.test(
      env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
    )
  )
    refuse("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  if (
    !/^https:\/\/[^/]+\.clerk\.accounts\.dev\/?$/.test(
      env.CLERK_JWT_ISSUER_DOMAIN ?? "",
    )
  )
    refuse("CLERK_JWT_ISSUER_DOMAIN");
  const host = Buffer.from(
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.slice(8),
    "base64",
  )
    .toString("utf8")
    .replace(/\$$/, "");
  if (new URL(env.CLERK_JWT_ISSUER_DOMAIN).hostname !== host)
    refuse("CLERK_KEY_ISSUER_MISMATCH");
  return env;
}

export function loadHrEnvironment() {
  let file;
  try {
    file = parseEnv(readFileSync(".env.local", "utf8"));
  } catch {
    throw new Error("HR_E2E_LOCAL_ENV_FILE_REQUIRED");
  }
  // Ambient selectors must not silently redirect a local command.
  for (const name of Object.keys(file)) {
    if (process.env[name] !== undefined && process.env[name] !== file[name])
      throw new Error(`HR_E2E_ENVIRONMENT_CONFLICT: ${name}`);
  }
  const env = assertHrEnvironment({ ...process.env, ...file });
  for (const name of Object.keys(file)) process.env[name] = file[name];
  return env;
}
