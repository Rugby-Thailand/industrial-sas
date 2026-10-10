import { existsSync, rmSync } from "node:fs";

import {
  FIXTURE_STATE,
  assertOwnedOrganization,
  assertOwnedUser,
  assertStagingInputs,
  convexRun,
  isNotFound,
  managerEmail,
  organizationName,
  ownershipArgs,
  readFixtureState,
  stagingClerk,
  verifyStagingInstance,
  writeFixtureState,
  type StagingClerkPort,
  type StagingFixtureState,
} from "./support";

export interface CleanupDependencies {
  clerk: StagingClerkPort;
  run: (fn: string, args: Record<string, unknown>) => unknown;
  statePath?: string;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}
type CleanupResult = { done: boolean; deleted: number; mirrorsPending: number };
function result(value: unknown): CleanupResult {
  if (value === null || typeof value !== "object")
    throw new Error("STAGING_CLEANUP_RESULT_INVALID");
  const output = value as CleanupResult;
  if (
    typeof output.done !== "boolean" ||
    !Number.isSafeInteger(output.deleted) ||
    output.deleted < 0 ||
    output.deleted > 200 ||
    !Number.isSafeInteger(output.mirrorsPending) ||
    output.mirrorsPending < 0 ||
    output.mirrorsPending > 4
  )
    throw new Error("STAGING_CLEANUP_RESULT_INVALID");
  return output;
}

/** Resolve only the exact synthetic intent when a creation response was lost. */
async function reconcileCreation(
  clerk: StagingClerkPort,
  state: StagingFixtureState,
  path: string,
) {
  if (state.pendingCreation === undefined) return;
  if (state.pendingCreation === "user") {
    const listed = await clerk.users.getUserList({
      emailAddress: [managerEmail(state.runId)],
      limit: 2,
    });
    if (listed.totalCount !== 1 || listed.data.length !== 1)
      throw new Error("STAGING_CREATION_OUTCOME_UNRECONCILED");
    const candidate = listed.data[0]!;
    const owned = { ...state, clerkUserId: candidate.id };
    assertOwnedUser(candidate, owned);
    state.clerkUserId = candidate.id;
  } else {
    const kind = state.pendingCreation;
    // The instance disables slugs. Clerk's query is a partial name match, so
    // bound it to two results and require one exact-name, metadata-owned row.
    const listed = await clerk.organizations.getOrganizationList({
      query: organizationName(state.runId, kind),
      limit: 2,
    });
    if (listed.totalCount !== 1 || listed.data.length !== 1)
      throw new Error("STAGING_CREATION_OUTCOME_UNRECONCILED");
    const candidate = listed.data[0]!;
    const owned = {
      ...state,
      ...(kind === "primary"
        ? { clerkOrganizationId: candidate.id }
        : { otherClerkOrganizationId: candidate.id }),
    };
    assertOwnedOrganization(candidate, owned, kind);
    if (kind === "primary") state.clerkOrganizationId = candidate.id;
    else state.otherClerkOrganizationId = candidate.id;
  }
  delete state.pendingCreation;
  writeFixtureState(state, path);
}

/** Exact recorded association only; no inferred/current replacement member. */
async function recordedMembership(
  clerk: StagingClerkPort,
  state: StagingFixtureState,
) {
  if (
    state.clerkMembershipId === undefined ||
    state.deleted?.primary ||
    state.deleted?.user
  )
    return false;
  if (
    state.clerkOrganizationId === undefined ||
    state.clerkUserId === undefined
  )
    throw new Error("STAGING_MEMBERSHIP_OWNERSHIP_REFUSED");
  try {
    const listed = await clerk.organizations.getOrganizationMembershipList({
      organizationId: state.clerkOrganizationId,
      userId: [state.clerkUserId],
      limit: 2,
    });
    if (listed.totalCount === 0 && listed.data.length === 0) return false;
    const member = listed.data[0];
    if (
      listed.totalCount !== 1 ||
      listed.data.length !== 1 ||
      member?.id !== state.clerkMembershipId ||
      member.organization.id !== state.clerkOrganizationId ||
      member.publicUserData?.userId !== state.clerkUserId
    )
      throw new Error("STAGING_MEMBERSHIP_OWNERSHIP_REFUSED");
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/** Backend first; metadata/readback verified before each exact Clerk deletion. */
export async function cleanupStagingFixture(
  deps: CleanupDependencies,
): Promise<void> {
  const path = deps.statePath ?? FIXTURE_STATE;
  if (!existsSync(path)) return;
  const state = readFixtureState(path);
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  try {
    await verifyStagingInstance(deps.clerk);
    await reconcileCreation(deps.clerk, state, path);
    // Refuse a changed ownership record before mutating even the backend.
    for (const kind of ["primary", "other"] as const) {
      const id =
        kind === "primary"
          ? state.clerkOrganizationId
          : state.otherClerkOrganizationId;
      if (id === undefined || state.deleted?.[kind]) continue;
      try {
        assertOwnedOrganization(
          await deps.clerk.organizations.getOrganization({
            organizationId: id,
          }),
          state,
          kind,
        );
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    if (state.clerkUserId !== undefined && !state.deleted?.user) {
      try {
        assertOwnedUser(
          await deps.clerk.users.getUser(state.clerkUserId),
          state,
        );
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    await recordedMembership(deps.clerk, state);
    const deadline = now() + 120_000;
    let backendDone = false;
    for (let batch = 0; batch < 100 && now() <= deadline; batch += 1) {
      const output = result(
        deps.run("staging/e2eFixture:cleanupPartial", {
          ...ownershipArgs(state),
          limit: 200,
        }),
      );
      if (output.done) {
        backendDone = true;
        break;
      }
    }
    if (!backendDone) throw new Error("STAGING_BACKEND_CLEANUP_INCOMPLETE");

    // Explicitly remove the verified recorded membership before parents so
    // Clerk emits its genuine membership.deleted event. Read the exact pair
    // again because this endpoint selects by org/user, not membership ID.
    if (await recordedMembership(deps.clerk, state)) {
      const removed =
        await deps.clerk.organizations.deleteOrganizationMembership({
          organizationId: state.clerkOrganizationId!,
          userId: state.clerkUserId!,
        });
      if (removed.id !== state.clerkMembershipId)
        throw new Error("STAGING_MEMBERSHIP_DELETE_OUTCOME_UNCERTAIN");
    }

    for (const kind of ["primary", "other"] as const) {
      const id =
        kind === "primary"
          ? state.clerkOrganizationId
          : state.otherClerkOrganizationId;
      if (id === undefined || state.deleted?.[kind]) continue;
      try {
        const organization = await deps.clerk.organizations.getOrganization({
          organizationId: id,
        });
        assertOwnedOrganization(organization, state, kind);
        await deps.clerk.organizations.deleteOrganization(id);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      state.deleted = { ...state.deleted, [kind]: true };
      writeFixtureState(state, path);
    }
    if (state.clerkUserId !== undefined && !state.deleted?.user) {
      try {
        const user = await deps.clerk.users.getUser(state.clerkUserId);
        assertOwnedUser(user, state);
        await deps.clerk.users.deleteUser(state.clerkUserId);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      state.deleted = { ...state.deleted, user: true };
      writeFixtureState(state, path);
    }

    // Real deletion webhooks must arrive. Repeat exact-owned cleanup so a late
    // create followed by delete cannot leave authorization seed rows behind.
    const mirrorDeadline = now() + 120_000;
    for (
      let attempt = 0;
      attempt < 100 && now() <= mirrorDeadline;
      attempt += 1
    ) {
      const output = result(
        deps.run("staging/e2eFixture:cleanupPartial", {
          ...ownershipArgs(state),
          limit: 200,
        }),
      );
      if (output.done && output.mirrorsPending === 0) {
        rmSync(path);
        return;
      }
      if (output.done) await sleep(2_000);
    }
    throw new Error("STAGING_DELETE_WEBHOOKS_UNCONFIRMED");
  } catch {
    // Keep the private ownership record for an exact-ID retry. Never return a
    // green cleanup or expose provider bodies, CLI stderr, tickets or tokens.
    throw new Error("STAGING_CLEANUP_INCOMPLETE_OWNERSHIP_RECORD_RETAINED");
  }
}

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(FIXTURE_STATE)) return;
  assertStagingInputs();
  await cleanupStagingFixture({ clerk: stagingClerk(), run: convexRun });
}
