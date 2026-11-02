import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { createClerkClient } from "@clerk/backend";
import { clerkSetup } from "@clerk/testing/playwright";

import {
  HR_TEST_IDENTITY,
  loadHrEnvironment,
} from "../../../scripts/lib/hr-e2e-env.mjs";

export const fixturePath = "playwright/.auth/hr-local-fixture.json";

export function localRun(name: string, args: Record<string, unknown>) {
  // Never permit arbitrary CLI functions, identity overrides, or remote targets.
  if (
    !/^staging\/(annexDemo:bootstrapLocalDemo|hrDemo:(seed|setLocalTestRoles|createLocalTestSite))$/.test(
      name,
    )
  )
    throw new Error("HR_E2E_SEED_FUNCTION_REFUSED");
  try {
    return JSON.parse(
      execFileSync(
        "pnpm",
        [
          "exec",
          "convex",
          "run",
          "--typecheck",
          "disable",
          "--codegen",
          "disable",
          name,
          JSON.stringify(args),
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 60_000,
        },
      ),
    );
  } catch {
    throw new Error("HR_E2E_LOCAL_SEED_FAILED");
  }
}

export function readHrFixture(): {
  warehouseId: string;
  otherWarehouseId: string;
} {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

export default async function setup() {
  const env = loadHrEnvironment();
  // The local state must belong to THIS checkout; never reuse a user's service.
  const config = JSON.parse(
    readFileSync(".convex/local/default/config.json", "utf8"),
  );
  if (
    config.ports.cloud !== 3320 ||
    config.ports.site !== 3321 ||
    env.CONVEX_DEPLOYMENT !== `anonymous:${config.deploymentName}`
  )
    throw new Error("HR_E2E_BACKEND_CHECKOUT_MISMATCH");
  const response = await fetch(`${env.NEXT_PUBLIC_CONVEX_URL}/instance_name`);
  if (!response.ok || (await response.text()) !== config.deploymentName)
    throw new Error("HR_E2E_BACKEND_INSTANCE_MISMATCH");

  const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  try {
    const users = await client.users.getUserList({
      emailAddress: [HR_TEST_IDENTITY.email],
    });
    if (
      users.data.length !== 1 ||
      users.data[0]?.id !== HR_TEST_IDENTITY.userId
    )
      throw new Error();
    const members = await client.organizations.getOrganizationMembershipList({
      organizationId: HR_TEST_IDENTITY.organizationId,
      userId: [HR_TEST_IDENTITY.userId],
    });
    if (
      members.data.length !== 1 ||
      members.data[0]?.publicUserData?.userId !== HR_TEST_IDENTITY.userId
    )
      throw new Error();
    await clerkSetup({
      dotenv: false,
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    });
  } catch {
    throw new Error("HR_E2E_DESIGNATED_CLERK_TEST_IDENTITY_UNVERIFIED");
  }
  const bootstrap = localRun("staging/annexDemo:bootstrapLocalDemo", {
    clerkUserId: HR_TEST_IDENTITY.userId,
    clerkOrganizationId: HR_TEST_IDENTITY.organizationId,
    displayName: HR_TEST_IDENTITY.email,
    email: HR_TEST_IDENTITY.email,
    confirmation: "SEED_DEMO_ANNEX_REALISTIC_2026_09",
    allowLocalTestSeed: true,
  });
  localRun("staging/hrDemo:seed", {
    warehouseId: bootstrap.warehouseId,
    actorUserId: bootstrap.userId,
    confirmation: "LOCAL_HR_FIXTURES_V1",
  });
  // Deliberately inaccessible local records. No fabricated Clerk session is
  // issued for this fixture actor; only the verified real account signs in.
  const other = localRun("staging/annexDemo:bootstrapLocalDemo", {
    clerkUserId: "local_hr_e2e_foreign",
    clerkOrganizationId: "local_hr_e2e_foreign_org",
    displayName: "Local HR foreign fixture",
    email: "foreign@example.invalid",
    confirmation: "SEED_DEMO_ANNEX_REALISTIC_2026_09",
    allowLocalTestSeed: true,
  });
  localRun("staging/hrDemo:seed", {
    warehouseId: other.warehouseId,
    actorUserId: other.userId,
    confirmation: "LOCAL_HR_FIXTURES_V1",
  });
  mkdirSync("playwright/.auth", { recursive: true, mode: 0o700 });
  chmodSync("playwright/.auth", 0o700);
  writeFileSync(
    fixturePath,
    JSON.stringify({
      warehouseId: bootstrap.warehouseId,
      otherWarehouseId: other.warehouseId,
    }),
    { mode: 0o600 },
  );
}
