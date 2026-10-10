import { existsSync } from "node:fs";

import { clerkSetup } from "@clerk/testing/playwright";

import {
  reportStagingSetupPhase,
  type StagingSetupPhase,
} from "../support/staging-setup-phase";
import { stagingSetupFailure } from "../../../scripts/release/lib/smoke-diagnostics.mjs";

import { cleanupStagingFixture } from "./global-teardown";
import {
  FIXTURE_STATE,
  STAGING,
  assertOwnedOrganization,
  assertOwnedUser,
  assertStagingInputs,
  convexRun,
  managerEmail,
  organizationName,
  ownershipArgs,
  ownershipMetadata,
  readReadyFixtureState,
  runId,
  stagingClerk,
  stagingPublishableKey,
  verifyStagingInstance,
  writeFixtureState,
  type ReadyFixtureState,
  type StagingClerkPort,
  type StagingFixtureState,
} from "./support";

export interface SetupDependencies {
  clerk: StagingClerkPort;
  run: (fn: string, args: Record<string, unknown>) => unknown;
  statePath?: string;
  runId?: string;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  testingSetup?: () => Promise<void>;
  onProgress?: (phase: StagingSetupPhase) => void;
}
function definitelyRejected(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    [400, 401, 403, 404, 422].includes(error.status)
  );
}

/** Create new resources only. Reuse/listing of persistent CI actors is refused. */
export async function provisionStagingFixture(
  deps: SetupDependencies,
): Promise<ReadyFixtureState> {
  const path = deps.statePath ?? FIXTURE_STATE;
  if (existsSync(path))
    throw new Error("STAGING_OWNERSHIP_RECORD_ALREADY_EXISTS");
  const id = deps.runId ?? runId();
  const state: StagingFixtureState = {
    version: 1,
    repository: STAGING.repository,
    clerkInstanceId: STAGING.clerkInstanceId,
    runId: id,
    managerEmail: managerEmail(id),
  };
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let step = "CLERK_INSTANCE";
  try {
    // Fixed instance ID and class are checked before any create/testing token.
    deps.onProgress?.("verify-instance");
    await verifyStagingInstance(deps.clerk);
    deps.onProgress?.("testing-token");
    step = "TESTING_TOKEN";
    await deps.testingSetup?.();
    step = "OWNERSHIP_STATE";
    writeFixtureState(state, path);
    state.pendingCreation = "user";
    writeFixtureState(state, path);
    deps.onProgress?.("create-user");
    step = "USER_CREATE";
    const user = await deps.clerk.users.createUser({
      externalId: `ci-e2e:${STAGING.repository}:${id}:actor`,
      emailAddress: [state.managerEmail],
      firstName: `CI E2E ${id}`,
      lastName: "actor",
      skipPasswordRequirement: true,
      privateMetadata: ownershipMetadata(id, "user"),
    });
    state.clerkUserId = user.id;
    delete state.pendingCreation;
    writeFixtureState(state, path);
    assertOwnedUser(user, state);
    for (const kind of ["primary", "other"] as const) {
      state.pendingCreation = kind;
      writeFixtureState(state, path);
      deps.onProgress?.(
        kind === "primary"
          ? "create-primary-organization"
          : "create-other-organization",
      );
      step =
        kind === "primary"
          ? "PRIMARY_ORGANIZATION_CREATE"
          : "OTHER_ORGANIZATION_CREATE";
      const organization = await deps.clerk.organizations.createOrganization({
        name: organizationName(id, kind),
        ...(kind === "primary" ? { createdBy: state.clerkUserId } : {}),
        privateMetadata: ownershipMetadata(id, kind),
      });
      if (kind === "primary") state.clerkOrganizationId = organization.id;
      else state.otherClerkOrganizationId = organization.id;
      delete state.pendingCreation;
      writeFixtureState(state, path);
      assertOwnedOrganization(organization, state, kind);
    }
    deps.onProgress?.("verify-membership");
    step = "MEMBERSHIP_READ";
    const memberships =
      await deps.clerk.organizations.getOrganizationMembershipList({
        organizationId: state.clerkOrganizationId!,
        userId: [state.clerkUserId!],
        limit: 2,
      });
    const membership = memberships.data[0];
    if (
      memberships.totalCount !== 1 ||
      memberships.data.length !== 1 ||
      membership === undefined ||
      membership.organization.id !== state.clerkOrganizationId ||
      membership.publicUserData?.userId !== state.clerkUserId
    )
      throw new Error("STAGING_MEMBERSHIP_OWNERSHIP_REFUSED");
    state.clerkMembershipId = membership.id;
    writeFixtureState(state, path);

    // No internal identity upserts: the genuine Clerk endpoint must deliver all
    // named user/org/member events and signed source watermarks to staging.
    deps.onProgress?.("identity-webhooks");
    step = "IDENTITY_WEBHOOKS";
    const deadline = now() + 120_000;
    for (let attempt = 0; ; attempt += 1) {
      const status = deps.run(
        "staging/e2eFixture:identityStatus",
        ownershipArgs(state),
      ) as {
        ready?: boolean;
        organizations?: number;
        user?: boolean;
        membership?: boolean;
      } | null;
      if (
        status?.ready === true &&
        status.organizations === 2 &&
        status.user === true &&
        status.membership === true
      )
        break;
      if (attempt >= 60 || now() >= deadline)
        throw new Error("STAGING_REAL_IDENTITY_WEBHOOKS_UNCONFIRMED");
      await sleep(2_000);
    }
    deps.onProgress?.("prepare-backend");
    step = "BACKEND_PREPARE";
    const prepared = deps.run(
      "staging/e2eFixture:prepare",
      ownershipArgs(state),
    ) as {
      runWarehouseId?: string;
      forbiddenWarehouseId?: string;
      otherTenantWarehouseId?: string;
    } | null;
    if (
      prepared === null ||
      !prepared.runWarehouseId ||
      !prepared.forbiddenWarehouseId ||
      !prepared.otherTenantWarehouseId
    )
      throw new Error("STAGING_PREPARE_RESULT_INVALID");
    state.runWarehouseId = prepared.runWarehouseId;
    state.forbiddenWarehouseId = prepared.forbiddenWarehouseId;
    state.otherTenantWarehouseId = prepared.otherTenantWarehouseId;
    step = "FIXTURE_READBACK";
    writeFixtureState(state, path);
    const ready = readReadyFixtureState(path);
    deps.onProgress?.("ready");
    return ready;
  } catch (error) {
    if (existsSync(path)) {
      if (state.pendingCreation !== undefined && definitelyRejected(error)) {
        delete state.pendingCreation;
        writeFixtureState(state, path);
      }
      try {
        await cleanupStagingFixture({ ...deps, statePath: path });
      } catch {
        throw new Error(stagingSetupFailure(step, error, true));
      }
    }
    throw new Error(stagingSetupFailure(step, error));
  }
}

export default async function globalSetup(): Promise<void> {
  reportStagingSetupPhase("validate-inputs");
  assertStagingInputs(process.env, (name) => {
    process.stdout.write(`[staging-input] ${name}\n`);
  });
  process.env.CLERK_PUBLISHABLE_KEY = stagingPublishableKey();
  await provisionStagingFixture({
    clerk: stagingClerk(),
    run: convexRun,
    onProgress: reportStagingSetupPhase,
    testingSetup: () =>
      clerkSetup({
        dotenv: false,
        publishableKey: stagingPublishableKey(),
        secretKey: process.env.CLERK_SECRET_KEY!,
      }),
  });
}
