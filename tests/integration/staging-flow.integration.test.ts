import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { internal } from "../../convex/_generated/api";
import type { IdentityWebhookEvent } from "../../convex/lib/identityWebhook";
import {
  E2E_FIXTURE_CONFIRMATION,
  organizationName,
  userDisplayName,
  userFirstName,
} from "../../convex/staging/e2eFixture";
import {
  expectDenied,
  runStorageFlow,
  type Execute,
} from "../e2e/staging/flows";
import { provisionStagingFixture } from "../e2e/staging/global-setup";
import { cleanupStagingFixture } from "../e2e/staging/global-teardown";
import {
  STAGING,
  assertStagingInputs,
  convexRun,
  managerEmail,
  ownershipMetadata,
  readFixtureState,
  readReadyFixtureState,
  writeFixtureState,
  type OwnedOrganization,
  type OwnedUser,
  type StagingClerkPort,
} from "../e2e/staging/support";
import {
  createConvexTenantWorld,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

const MODULES: ConvexTestModuleMap = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../convex/**/*.ts",
      "!../../convex/_generated/**",
      "!../../convex/**/*.test.ts",
    ]) as Record<string, () => Promise<unknown>>,
  ).map(([path, load]) => [path.replace("../../convex/", "../convex/"), load]),
);
const temporary: string[] = [];
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error(
        "Unexpected network in a credential-free integration test.",
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function statePath() {
  const directory = mkdtempSync(join(tmpdir(), "industrial-e2e-test-"));
  temporary.push(directory);
  return join(directory, "ownership.json");
}

/** Real registered normalized mirrors and shipping mutations; no JWT proof. */
async function preparedStaging() {
  vi.stubEnv("CONVEX_CLOUD_URL", "https://befitting-stoat-208.convex.cloud");
  vi.stubEnv("E2E_FIXTURE_TARGET", "befitting-stoat-208");
  const world = await createConvexTenantWorld(MODULES);
  const runId = "flow-run-01";
  const args = {
    confirmation: E2E_FIXTURE_CONFIRMATION,
    runId,
    clerkOrganizationId: "org_flow_primary",
    otherClerkOrganizationId: "org_flow_other",
    clerkUserId: "user_flow_actor",
    clerkMembershipId: "orgmem_flow_actor",
  } as const;
  const clock = Date.now() - 100;
  const events: IdentityWebhookEvent[] = [
    {
      type: "organization.upsert",
      eventId: "msg_flow_primary",
      eventAt: clock,
      eventTimestamp: clock,
      data: {
        clerkOrganizationId: args.clerkOrganizationId,
        name: organizationName(runId, "primary"),
      },
    },
    {
      type: "organization.upsert",
      eventId: "msg_flow_other",
      eventAt: clock,
      eventTimestamp: clock,
      data: {
        clerkOrganizationId: args.otherClerkOrganizationId,
        name: organizationName(runId, "other"),
      },
    },
    {
      type: "user.upsert",
      eventId: "msg_flow_user",
      eventAt: clock,
      eventTimestamp: clock,
      data: {
        clerkUserId: args.clerkUserId,
        displayName: userDisplayName(runId),
      },
    },
    {
      type: "membership.upsert",
      eventId: "msg_flow_member",
      eventAt: clock,
      eventTimestamp: clock,
      data: {
        clerkOrganizationId: args.clerkOrganizationId,
        name: organizationName(runId, "primary"),
        clerkUserId: args.clerkUserId,
        displayName: userDisplayName(runId),
        clerkMembershipId: args.clerkMembershipId,
      },
    },
  ];
  for (const event of events)
    await world.t.mutation(
      internal.lib.identityMirrorConvex.applyClerkIdentityEvent,
      { event },
    );
  const fixture = await world.t.mutation(
    internal.staging.e2eFixture.prepare,
    args,
  );
  const asManager = world.t.withIdentity({
    subject: args.clerkUserId,
    org_id: args.clerkOrganizationId,
  });
  const execute: Execute = async (kind, name, payload) =>
    kind === "query"
      ? await asManager.query(makeFunctionReference<"query">(name), payload)
      : await asManager.mutation(
          makeFunctionReference<"mutation">(name),
          payload,
        );
  return { world, fixture, execute, args };
}

describe("shipping staging write and cleanup flow", () => {
  it("runs registered layout, placement, pallet move and readback, then cleans all generated run data", async () => {
    const { world, fixture, execute, args } = await preparedStaging();
    const result = await runStorageFlow(execute, {
      runId: args.runId,
      warehouseId: fixture.runWarehouseId,
    });
    expect(result.buildingCode).toBe("E2E-FLOW-RUN-01-B");
    expect(result.sourceZoneCode).not.toBe(result.targetZoneCode);
    const populated = await world.t.run(async (ctx) => ({
      contributions: (
        await ctx.db.query("finishedGoodsUnitContributions").collect()
      ).length,
      moves: (await ctx.db.query("finishedGoodsMoves").collect()).length,
    }));
    expect(populated.contributions).toBeGreaterThan(0);
    expect(populated.moves).toBe(1);
    let done = false;
    for (let batch = 0; batch < 100; batch += 1) {
      const cleaned = await world.t.mutation(
        internal.staging.e2eFixture.cleanup,
        { ...args, limit: 3 },
      );
      expect(cleaned.deleted).toBeLessThanOrEqual(3);
      if (cleaned.done) {
        done = true;
        break;
      }
    }
    expect(done).toBe(true);
    expect(
      await world.t.run(async (ctx) => ({
        products: await ctx.db.query("finishedGoodsProducts").collect(),
        pallets: await ctx.db.query("finishedGoodsPallets").collect(),
        moves: await ctx.db.query("finishedGoodsMoves").collect(),
        placements: await ctx.db.query("finishedGoodsPlacements").collect(),
        contributions: await ctx.db
          .query("finishedGoodsUnitContributions")
          .collect(),
        zones: await ctx.db.query("storageZones").collect(),
        audit: await ctx.db.query("auditEvents").collect(),
        idempotency: await ctx.db.query("idempotencyRecords").collect(),
      })),
    ).toEqual({
      products: [],
      pallets: [],
      moves: [],
      placements: [],
      contributions: [],
      zones: [],
      audit: [],
      idempotency: [],
    });
  });
  it("denies both layout and pallet move calls in forbidden warehouses and other tenants", async () => {
    const { fixture, execute, args } = await preparedStaging();
    const flow = await runStorageFlow(execute, {
      runId: args.runId,
      warehouseId: fixture.runWarehouseId,
    });
    const detail = (await execute("query", "finishedGoods/workflow:getPallet", {
      warehouseId: fixture.runWarehouseId,
      palletId: flow.palletId,
    })) as {
      ok: boolean;
      value: { placement: { _id: string; zoneId: string } };
    };
    expect(detail.ok).toBe(true);
    for (const [warehouseId, expected] of [
      [fixture.forbiddenWarehouseId, "WAREHOUSE_OUT_OF_SCOPE"],
      [fixture.otherTenantWarehouseId, "WAREHOUSE_UNKNOWN"],
    ] as const) {
      const layout = () =>
        execute("mutation", "storageLayouts/writes:createStorageBuilding", {
          warehouseId,
          requestId: "denied-layout",
          code: "E2E-DENIED",
          name: "Denied",
          widthMm: 1_000,
          depthMm: 1_000,
          defaultFloorHeightMm: 3_000,
          floorCount: 1,
        });
      expect(await expectDenied("layout context", layout)).toBe(expected);
      const move = () =>
        execute("mutation", "finishedGoods/workflow:reserveMove", {
          warehouseId,
          palletId: flow.palletId,
          requestId: "denied-move",
          zoneId: detail.value.placement.zoneId,
          expectedSourcePlacementId: detail.value.placement._id,
          xMm: 0,
          yMm: 0,
          rotation: 0,
        });
      expect(await expectDenied("move context", move)).toBe(expected);
    }
    await expect(
      expectDenied("allowed read", () =>
        execute("query", "workspace/current:readCurrent", {}),
      ),
    ).rejects.toThrow(/was allowed/);
  });
});

const LOCAL_ENV = {
  SMOKE_TARGET: "staging",
  SMOKE_BASE_URL: STAGING.appUrl,
  STAGING_E2E_LOCAL_REHEARSAL: "1",
  CLERK_SECRET_KEY: "sk_test_synthetic",
  CONVEX_DEPLOY_KEY: "dev:befitting-stoat-208|synthetic",
};
describe("trusted staging input and subprocess boundaries", () => {
  it("requires exact stage URL, dev target key and explicit trusted ref/local mode", () => {
    expect(() => assertStagingInputs(LOCAL_ENV)).not.toThrow();
    for (const change of [
      { SMOKE_BASE_URL: "https://app.thaipropertyai.com" },
      { SMOKE_BASE_URL: `${STAGING.appUrl}/other` },
      { SMOKE_BASE_URL: `${STAGING.appUrl}/?token=synthetic` },
      { SMOKE_TARGET: "production" },
      { CLERK_SECRET_KEY: "sk_live_synthetic" },
      { CONVEX_DEPLOY_KEY: "prod:befitting-stoat-208|synthetic" },
      { CONVEX_DEPLOY_KEY: "dev:greedy-cardinal-537|synthetic" },
      { CONVEX_ADMIN_KEY: "synthetic" },
      { CONVEX_DEPLOYMENT: "dev:befitting-stoat-208" },
      { GITHUB_ACTIONS: "false" },
      {
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: STAGING.repository,
        GITHUB_REF: "refs/pull/1/merge",
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_RUN_ID: "1",
        GITHUB_RUN_ATTEMPT: "1",
      },
    ])
      expect(() => assertStagingInputs({ ...LOCAL_ENV, ...change })).toThrow(
        /STAGING_INPUTS_INVALID/,
      );
    expect(() =>
      assertStagingInputs({
        ...LOCAL_ENV,
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: STAGING.repository,
        GITHUB_REF: "refs/heads/main",
        GITHUB_EVENT_NAME: "push",
        GITHUB_RUN_ID: "1",
        GITHUB_RUN_ATTEMPT: "1",
      }),
    ).not.toThrow();
  });
  it("sends only stage key to CLI with NODE_ENV test and suppresses raw failures", () => {
    let privateEnvFile = "";
    const spawn = vi.mocked(spawnSync).mockImplementation((_command, args) => {
      const index = args!.indexOf("--env-file");
      privateEnvFile = args![index + 1]!;
      expect(statSync(privateEnvFile).mode & 0o777).toBe(0o600);
      expect(readFileSync(privateEnvFile, "utf8")).toBe(
        `CONVEX_DEPLOY_KEY='${LOCAL_ENV.CONVEX_DEPLOY_KEY}'\n`,
      );
      expect(args).not.toContain("--deployment");
      return {
        pid: 1,
        output: [null, "", "sk_live_synthetic_private_body"],
        stdout: "",
        stderr: "sk_live_synthetic_private_body",
        status: 1,
        signal: null,
      };
    });
    expect(() =>
      convexRun(
        "staging/e2eFixture:cleanupPartial",
        { confirmation: E2E_FIXTURE_CONFIRMATION, runId: "offline-run-01" },
        LOCAL_ENV,
      ),
    ).toThrow(/^STAGING_CONVEX_COMMAND_FAILED$/);
    const options = spawn.mock.calls[0]?.[2];
    expect(options?.env).toMatchObject({
      NODE_ENV: "test",
    });
    expect(options?.env).not.toHaveProperty("CONVEX_DEPLOY_KEY");
    expect(options?.env).not.toHaveProperty("CLERK_SECRET_KEY");
    expect(existsSync(privateEnvFile)).toBe(false);
    expect(() =>
      convexRun(
        "onboarding/bootstrapOrganization:grantFirstAdminAndCreateWarehouse",
        {},
        LOCAL_ENV,
      ),
    ).toThrow(/FUNCTION_REFUSED/);
  });
});

/** Provider port stub exercises orchestration only; native auth is browser-only. */
function provider(path: string) {
  const log: string[] = [];
  const users = new Map<string, OwnedUser>();
  const organizations = new Map<string, OwnedOrganization>();
  let membershipPresent = true;
  const clerk: StagingClerkPort = {
    instance: {
      get: async () => {
        log.push("instance");
        return { id: STAGING.clerkInstanceId, environmentType: "development" };
      },
    },
    users: {
      createUser: async (args) => {
        const state = readFixtureState(path);
        expect(state.pendingCreation).toBe("user");
        expect(statSync(path).mode & 0o777).toBe(0o600);
        log.push("create-user");
        const user: OwnedUser = {
          id: "user_synthetic_actor",
          firstName: args.firstName ?? null,
          lastName: args.lastName ?? null,
          externalId: args.externalId ?? null,
          emailAddresses: (args.emailAddress ?? []).map((emailAddress) => ({
            emailAddress,
          })),
          privateMetadata: args.privateMetadata ?? {},
        };
        users.set(user.id, user);
        return user;
      },
      getUser: async (id) => {
        const user = users.get(id);
        if (!user) throw { status: 404 };
        return user;
      },
      getUserList: async ({ emailAddress }) => {
        const data = [...users.values()].filter((user) =>
          user.emailAddresses.some((row) =>
            emailAddress.includes(row.emailAddress),
          ),
        );
        return { data, totalCount: data.length };
      },
      deleteUser: async (id) => {
        log.push("delete-user");
        users.delete(id);
      },
    },
    organizations: {
      createOrganization: async (args) => {
        const state = readFixtureState(path);
        expect(state.clerkUserId).toBeDefined();
        expect(args).not.toHaveProperty("slug");
        const kind = args.privateMetadata?.ciE2eKind;
        expect(["primary", "other"]).toContain(kind);
        expect(state.pendingCreation).toBe(kind);
        if (kind === "other") expect(state.clerkOrganizationId).toBeDefined();
        log.push(`create-${kind}`);
        const org = {
          id: `org_synthetic_${kind}`,
          name: args.name,
          slug: args.slug ?? null,
          privateMetadata: args.privateMetadata ?? {},
        };
        organizations.set(org.id, org);
        return org;
      },
      getOrganization: async (args) => {
        const org = organizations.get(args.organizationId);
        if (!org) throw { status: 404 };
        return org;
      },
      getOrganizationList: async ({ query, limit }) => {
        expect(limit).toBe(2);
        const state = readFixtureState(path);
        expect([
          organizationName(state.runId, "primary"),
          organizationName(state.runId, "other"),
        ]).toContain(query);
        const data = [...organizations.values()].filter((row) =>
          row.name.includes(query),
        );
        return { data: data.slice(0, limit), totalCount: data.length };
      },
      deleteOrganization: async (id) => {
        log.push(`delete-${id}`);
        organizations.delete(id);
      },
      getOrganizationMembershipList: async ({ organizationId, userId }) => {
        const state = readFixtureState(path);
        expect(state.otherClerkOrganizationId).toBeDefined();
        if (!membershipPresent) return { data: [], totalCount: 0 };
        return {
          data: [
            {
              id: "orgmem_synthetic_actor",
              organization: { id: organizationId },
              publicUserData: { userId: userId[0]! },
            },
          ],
          totalCount: 1,
        };
      },
      deleteOrganizationMembership: async ({ organizationId, userId }) => {
        const state = readFixtureState(path);
        expect(organizationId).toBe(state.clerkOrganizationId);
        expect(userId).toBe(state.clerkUserId);
        log.push("delete-member");
        membershipPresent = false;
        return { id: state.clerkMembershipId! };
      },
    },
  };
  const run = (name: string) => {
    log.push(name);
    if (name.endsWith(":identityStatus"))
      return { ready: true, organizations: 2, user: true, membership: true };
    if (name.endsWith(":prepare"))
      return {
        runWarehouseId: "aaaa1111",
        forbiddenWarehouseId: "bbbb2222",
        otherTenantWarehouseId: "cccc3333",
      };
    return {
      done: true,
      deleted: 0,
      mirrorsPending: users.size === 0 && organizations.size === 0 ? 0 : 4,
    };
  };
  return { clerk, run, log, users, organizations };
}

describe("per-run provisioning and owned-resource recovery controller", () => {
  it("keeps numeric GitHub run IDs out of Clerk names while preserving exact ownership", async () => {
    const path = statePath();
    const model = provider(path);
    const create = model.clerk.users.createUser;
    model.clerk.users.createUser = async (args) => {
      // Clerk rejects some long numeric runs as phone numbers in first_name.
      if (/\d{10,}/.test(args.firstName ?? "")) {
        throw { status: 422 };
      }
      return create(args);
    };
    const state = await provisionStagingFixture({
      ...model,
      statePath: path,
      runId: "gh-38036644786-1-0123abcd",
    });
    const user = model.users.get(state.clerkUserId)!;
    expect(`${user.firstName} ${user.lastName}`).toBe(
      userDisplayName(state.runId),
    );
    expect(user.privateMetadata.ciE2eRun).toBe(state.runId);
    expect(userFirstName("offline-1")).not.toBe(userFirstName("offline-b"));
    await cleanupStagingFixture({ ...model, statePath: path });
    expect(model.users.size).toBe(0);
    expect(existsSync(path)).toBe(false);
  });

  it("identifies an instance authorization failure without exposing its provider response", async () => {
    const path = statePath();
    const model = provider(path);
    model.clerk.instance.get = async () => {
      throw { status: 401, message: "secret-provider-response" };
    };
    await expect(
      provisionStagingFixture({
        ...model,
        statePath: path,
        runId: "offline-run-01",
      }),
    ).rejects.toThrow(
      "STAGING_SETUP_FAILED: STAGING_SETUP_CLERK_INSTANCE_FAILED, STAGING_PROVIDER_HTTP_401",
    );
    expect(existsSync(path)).toBe(false);
    expect(model.users.size).toBe(0);
    expect(model.organizations.size).toBe(0);
  });

  it("verifies exact instance before creating, persists each ID privately, and cleans backend before Clerk resources", async () => {
    const path = statePath();
    const model = provider(path);
    const state = await provisionStagingFixture({
      ...model,
      statePath: path,
      runId: "offline-run-01",
    });
    expect(model.log[0]).toBe("instance");
    expect(state.managerEmail).toBe(managerEmail(state.runId));
    expect(state.clerkUserId).toBe("user_synthetic_actor");
    expect(readReadyFixtureState(path)).toEqual(state);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    await cleanupStagingFixture({ ...model, statePath: path });
    const backend = model.log.indexOf("staging/e2eFixture:cleanupPartial");
    expect(backend).toBeLessThan(
      model.log.indexOf("delete-org_synthetic_primary"),
    );
    expect(backend).toBeLessThan(model.log.indexOf("delete-user"));
    expect(backend).toBeLessThan(model.log.indexOf("delete-member"));
    expect(model.log.indexOf("delete-member")).toBeLessThan(
      model.log.indexOf("delete-org_synthetic_primary"),
    );
    expect(model.users.size).toBe(0);
    expect(model.organizations.size).toBe(0);
    expect(existsSync(path)).toBe(false);
  });
  it("refuses a different development instance before any writes", async () => {
    const path = statePath();
    const model = provider(path);
    const phases: string[] = [];
    model.clerk.instance.get = async () => ({
      id: "ins_wrong_development",
      environmentType: "development",
    });
    await expect(
      provisionStagingFixture({
        ...model,
        statePath: path,
        runId: "offline-run-01",
        onProgress: (phase) => phases.push(phase),
      }),
    ).rejects.toThrow(
      "STAGING_SETUP_FAILED: STAGING_SETUP_CLERK_INSTANCE_FAILED, STAGING_CLERK_INSTANCE_REFUSED",
    );
    expect(phases).toEqual(["verify-instance"]);
    expect(model.users.size).toBe(0);
    expect(model.organizations.size).toBe(0);
    expect(existsSync(path)).toBe(false);
  });
  it.each(["id", "organization", "user", "ambiguous"] as const)(
    "refuses recorded membership %s mismatch before backend or Clerk deletion",
    async (gap) => {
      const path = statePath();
      const model = provider(path);
      const state = await provisionStagingFixture({
        ...model,
        statePath: path,
        runId: "offline-run-01",
      });
      model.clerk.organizations.getOrganizationMembershipList = async () => {
        const member = {
          id: gap === "id" ? "orgmem_unowned" : state.clerkMembershipId,
          organization: {
            id:
              gap === "organization"
                ? "org_unowned"
                : state.clerkOrganizationId,
          },
          publicUserData: {
            userId: gap === "user" ? "user_unowned" : state.clerkUserId,
          },
        };
        return {
          data: gap === "ambiguous" ? [member, member] : [member],
          totalCount: gap === "ambiguous" ? 2 : 1,
        };
      };
      await expect(
        cleanupStagingFixture({ ...model, statePath: path }),
      ).rejects.toThrow(/OWNERSHIP_RECORD_RETAINED/);
      expect(model.log.some((entry) => entry.startsWith("delete-"))).toBe(
        false,
      );
      expect(model.log).not.toContain("staging/e2eFixture:cleanupPartial");
      expect(existsSync(path)).toBe(true);
    },
  );
  it("preserves the ledger and performs no deletion if ownership metadata changes", async () => {
    const path = statePath();
    const model = provider(path);
    const state = await provisionStagingFixture({
      ...model,
      statePath: path,
      runId: "offline-run-01",
    });
    const org = model.organizations.get(state.clerkOrganizationId)!;
    org.privateMetadata = ownershipMetadata("different-run-01", "primary");
    await expect(
      cleanupStagingFixture({ ...model, statePath: path }),
    ).rejects.toThrow(/^STAGING_CLEANUP_INCOMPLETE_OWNERSHIP_RECORD_RETAINED$/);
    expect(model.log.some((entry) => entry.startsWith("delete-"))).toBe(false);
    expect(model.log).not.toContain("staging/e2eFixture:cleanupPartial");
    expect(existsSync(path)).toBe(true);
  });
  it("retains owned IDs when backend cleanup fails and hides provider details", async () => {
    const path = statePath();
    const model = provider(path);
    await provisionStagingFixture({
      ...model,
      statePath: path,
      runId: "offline-run-01",
    });
    await expect(
      cleanupStagingFixture({
        ...model,
        statePath: path,
        run: () => {
          throw new Error("sk_live_synthetic_private_body");
        },
      }),
    ).rejects.toThrow(/^STAGING_CLEANUP_INCOMPLETE_OWNERSHIP_RECORD_RETAINED$/);
    expect(model.log.some((entry) => entry.startsWith("delete-"))).toBe(false);
    expect(readFixtureState(path).clerkUserId).toBeDefined();
  });
  it("recovers an uncertain creation only by its exact owned email and metadata", async () => {
    const path = statePath();
    const model = provider(path);
    const create = model.clerk.users.createUser;
    model.clerk.users.createUser = async (args) => {
      await create(args);
      throw new Error("lost provider response");
    };
    await expect(
      provisionStagingFixture({
        ...model,
        statePath: path,
        runId: "offline-run-01",
      }),
    ).rejects.toThrow("STAGING_SETUP_FAILED: STAGING_SETUP_USER_CREATE_FAILED");
    expect(model.users.size).toBe(0);
    expect(existsSync(path)).toBe(false);
  });

  it("recovers a lost organization response using bounded exact-name and metadata ownership without slugs", async () => {
    const path = statePath();
    const model = provider(path);
    const create = model.clerk.organizations.createOrganization;
    const list = vi.fn(model.clerk.organizations.getOrganizationList);
    model.clerk.organizations.getOrganizationList = list;
    model.clerk.organizations.createOrganization = async (args) => {
      await create(args);
      throw new Error("lost organization response");
    };
    await expect(
      provisionStagingFixture({
        ...model,
        statePath: path,
        runId: "offline-run-01",
      }),
    ).rejects.toThrow(
      "STAGING_SETUP_FAILED: STAGING_SETUP_PRIMARY_ORGANIZATION_CREATE_FAILED",
    );
    expect(list).toHaveBeenCalledExactlyOnceWith({
      query: organizationName("offline-run-01", "primary"),
      limit: 2,
    });
    expect(model.log).toContain("delete-org_synthetic_primary");
    expect(model.users.size).toBe(0);
    expect(model.organizations.size).toBe(0);
    expect(existsSync(path)).toBe(false);
  });

  it.each(["metadata", "partial-name", "ambiguous"] as const)(
    "retains an uncertain organization ledger and deletes nothing on %s mismatch",
    async (mismatch) => {
      const path = statePath();
      const model = provider(path);
      const create = model.clerk.organizations.createOrganization;
      model.clerk.organizations.createOrganization = async (args) => {
        const org = await create(args);
        if (mismatch === "metadata")
          org.privateMetadata = ownershipMetadata("unowned-run-01", "primary");
        if (mismatch === "partial-name") org.name += " other";
        if (mismatch === "ambiguous")
          model.organizations.set("org_unowned_collision", {
            ...org,
            id: "org_unowned_collision",
            privateMetadata: ownershipMetadata("unowned-run-01", "primary"),
          });
        throw new Error("lost organization response");
      };
      await expect(
        provisionStagingFixture({
          ...model,
          statePath: path,
          runId: "offline-run-01",
        }),
      ).rejects.toThrow(
        "STAGING_SETUP_FAILED_OWNERSHIP_RECORD_RETAINED: STAGING_SETUP_PRIMARY_ORGANIZATION_CREATE_FAILED",
      );
      expect(model.log.some((entry) => entry.startsWith("delete-"))).toBe(
        false,
      );
      expect(model.log).not.toContain("staging/e2eFixture:cleanupPartial");
      expect(readFixtureState(path).pendingCreation).toBe("primary");
      expect(model.users.size).toBe(1);
    },
  );
  it("rejects public ownership files and never silently reuses an existing ledger", async () => {
    const path = statePath();
    const model = provider(path);
    const state = await provisionStagingFixture({
      ...model,
      statePath: path,
      runId: "offline-run-01",
    });
    await expect(
      provisionStagingFixture({
        ...model,
        statePath: path,
        runId: "offline-run-02",
      }),
    ).rejects.toThrow(/ALREADY_EXISTS/);
    chmodSync(path, 0o644);
    expect(() => readFixtureState(path)).toThrow(/NOT_PRIVATE/);
    chmodSync(path, 0o600);
    writeFixtureState(state, path);
    expect(readFixtureState(path)).toEqual(state);
  });
});
