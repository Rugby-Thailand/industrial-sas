import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createClerkClient } from "@clerk/backend";

const execFileAsync = promisify(execFile);
const ROOT = new URL("..", import.meta.url);
const ENV_PATH = new URL(".env.local", ROOT);
const EXPECTED_EMAIL = "local.tester@example.com";
const EXPECTED_ORGANIZATION_ID = "org_3JXrDUraQjTRO3hcIzMGC9CvIXV";
const EXPECTED_USER_ID = "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd";
const DESTINATION = "http://localhost:3100/th/master-data/storage-layouts";

function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function requireValue(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in .env.local`);
  return value;
}

function loopbackUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (
    parsed.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  ) {
    throw new Error(`${name} must use an HTTP loopback URL`);
  }
  return parsed;
}

function checkLocalEnvironment(env) {
  if (
    !/^(?:anonymous:|local:)[^:]+$/u.test(
      requireValue(env, "CONVEX_DEPLOYMENT"),
    )
  ) {
    throw new Error("CONVEX_DEPLOYMENT must be an anonymous local deployment");
  }
  const convexUrl = loopbackUrl(
    requireValue(env, "NEXT_PUBLIC_CONVEX_URL"),
    "NEXT_PUBLIC_CONVEX_URL",
  );
  if (convexUrl.port !== "3320")
    throw new Error("NEXT_PUBLIC_CONVEX_URL must use local Convex port 3320");
  const appUrl = loopbackUrl(
    requireValue(env, "NEXT_PUBLIC_APP_URL"),
    "NEXT_PUBLIC_APP_URL",
  );
  if (appUrl.port !== "3100")
    throw new Error("NEXT_PUBLIC_APP_URL must use local app port 3100");
  if (
    !/^sk_test_[A-Za-z0-9_-]+$/u.test(requireValue(env, "CLERK_SECRET_KEY"))
  ) {
    throw new Error("CLERK_SECRET_KEY must be a Clerk test key");
  }
  if (
    !/^pk_test_[A-Za-z0-9_-]+$/u.test(
      requireValue(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
    )
  ) {
    throw new Error(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a Clerk test key",
    );
  }
  const issuer = requireValue(env, "CLERK_JWT_ISSUER_DOMAIN");
  if (!/^https:\/\/[^/]+\.clerk\.accounts\.dev\/?$/u.test(issuer)) {
    throw new Error(
      "CLERK_JWT_ISSUER_DOMAIN must be a Clerk development domain",
    );
  }
}

async function main() {
  let env;
  try {
    env = parseEnv(await readFile(ENV_PATH, "utf8"));
  } catch {
    throw new Error(".env.local is required");
  }
  checkLocalEnvironment(env);
  const appUrl = new URL(env.NEXT_PUBLIC_APP_URL.trim());

  const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const users = await client.users.getUserList({
    emailAddress: [EXPECTED_EMAIL],
  });
  if (users.data.length !== 1 || users.data[0].id !== EXPECTED_USER_ID) {
    throw new Error("The designated local test user was not found exactly");
  }
  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId: EXPECTED_ORGANIZATION_ID,
    userId: [EXPECTED_USER_ID],
  });
  if (memberships.data.length !== 1) {
    throw new Error(
      "The designated local test organization membership was not found exactly",
    );
  }

  const token = await client.signInTokens.createSignInToken({
    userId: EXPECTED_USER_ID,
    orgId: EXPECTED_ORGANIZATION_ID,
    expiresInSeconds: 300,
  });
  const url = new URL("/th/sign-in", appUrl);
  url.searchParams.set("__clerk_ticket", token.token);
  url.searchParams.set("__clerk_status", "sign_in");
  url.searchParams.set("redirect_url", DESTINATION);
  try {
    await execFileAsync("open", [url.toString()]);
  } catch {
    throw new Error(
      "Could not open the local development login in the default browser",
    );
  }
  console.log(
    `Opened local development login for ${EXPECTED_EMAIL}: ${DESTINATION}`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Development login failed",
  );
  process.exitCode = 1;
});
