import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createClerkClient } from "@clerk/backend";

import {
  E2E_FIXTURE_CONFIRMATION,
  organizationName,
  userDisplayName,
} from "../../../convex/staging/e2eFixture";
import {
  classifyConvexDeployKey,
  decodePublishableKey,
} from "../../../scripts/release/lib/credential-shapes.mjs";

export const STAGING = {
  repository: "Rugby-Thailand/industrial-sas",
  appUrl: "https://industrial-sas-staging.vercel.app",
  convexDeployment: "befitting-stoat-208",
  clerkFrontendHost: "creative-doberman-56.clerk.accounts.dev",
  clerkInstanceId: "ins_3Hx3Wa0m4xgQsBZ7Kyod5wNP1AC",
  confirmation: E2E_FIXTURE_CONFIRMATION,
} as const;
export { organizationName, userDisplayName };
export const FIXTURE_STATE = "playwright/.auth/staging-fixture.json";
const RUN_ID = /^[a-z0-9][a-z0-9-]{5,39}$/;
type Environment = Readonly<Record<string, string | undefined>>;

export interface StagingFixtureState {
  readonly version: 1;
  readonly runId: string;
  readonly repository: typeof STAGING.repository;
  readonly clerkInstanceId: typeof STAGING.clerkInstanceId;
  readonly managerEmail: string;
  clerkUserId?: string;
  clerkOrganizationId?: string;
  otherClerkOrganizationId?: string;
  clerkMembershipId?: string;
  runWarehouseId?: string;
  forbiddenWarehouseId?: string;
  otherTenantWarehouseId?: string;
  pendingCreation?: "user" | "primary" | "other";
  deleted?: { primary?: boolean; other?: boolean; user?: boolean };
}
type ReadyKeys =
  | "clerkUserId"
  | "clerkOrganizationId"
  | "otherClerkOrganizationId"
  | "clerkMembershipId"
  | "runWarehouseId"
  | "forbiddenWarehouseId"
  | "otherTenantWarehouseId";
export type ReadyFixtureState = StagingFixtureState &
  Required<Pick<StagingFixtureState, ReadyKeys>>;

export function stagingPublishableKey(): string {
  return `pk_test_${Buffer.from(`${STAGING.clerkFrontendHost}$`).toString("base64")}`;
}
export function convexCloudUrl(): string {
  return `https://${STAGING.convexDeployment}.convex.cloud`;
}
export function managerEmail(runId: string) {
  if (!RUN_ID.test(runId)) throw new Error("STAGING_RUN_ID_INVALID");
  return `ci-e2e-${runId}+clerk_test@example.com`;
}
export function assertStagingInputs(env: Environment = process.env): void {
  const problems: string[] = [];
  try {
    const base = new URL(env.SMOKE_BASE_URL ?? "");
    if (base.href !== `${STAGING.appUrl}/` || base.username || base.password)
      throw new Error();
  } catch {
    problems.push("SMOKE_BASE_URL");
  }
  if (env.SMOKE_TARGET !== "staging") problems.push("SMOKE_TARGET");
  if (!/^sk_test_\S+$/.test(env.CLERK_SECRET_KEY ?? ""))
    problems.push("CLERK_SECRET_KEY");
  const key = classifyConvexDeployKey(env.CONVEX_DEPLOY_KEY);
  if (
    key.kind !== "deployment" ||
    key.keyClass !== "dev" ||
    key.deployment !== STAGING.convexDeployment ||
    /[\s'"\\]/.test(env.CONVEX_DEPLOY_KEY ?? "")
  )
    problems.push("CONVEX_DEPLOY_KEY");
  for (const name of [
    "CONVEX_DEPLOYMENT",
    "CONVEX_ADMIN_KEY",
    "CONVEX_BACKUP_ADMIN_KEY",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
    "CONVEX_SELF_HOSTED_URL",
    "CLERK_API_URL",
  ]) {
    if (env[name]?.trim()) problems.push(name);
  }
  for (const name of [
    "CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  ]) {
    if (env[name] !== undefined) {
      const parsed = decodePublishableKey(env[name]);
      if (
        parsed?.keyClass !== "test" ||
        parsed.frontendHost !== STAGING.clerkFrontendHost
      )
        problems.push(name);
    }
  }
  for (const name of ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL"]) {
    if (env[name] !== undefined && env[name] !== convexCloudUrl())
      problems.push(name);
  }
  if (env.GITHUB_ACTIONS === "true") {
    if (env.GITHUB_REPOSITORY !== STAGING.repository)
      problems.push("GITHUB_REPOSITORY");
    if (env.GITHUB_REF !== "refs/heads/main") problems.push("GITHUB_REF");
    if (!["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME ?? ""))
      problems.push("GITHUB_EVENT_NAME");
    if (
      !/^\d+$/.test(env.GITHUB_RUN_ID ?? "") ||
      !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? "")
    )
      problems.push("GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT");
  } else if (
    env.GITHUB_ACTIONS !== undefined ||
    env.STAGING_E2E_LOCAL_REHEARSAL !== "1" ||
    env.GITHUB_REF ||
    env.GITHUB_REPOSITORY ||
    env.GITHUB_EVENT_NAME
  ) {
    problems.push("STAGING_E2E_LOCAL_REHEARSAL");
  }
  if (problems.length > 0)
    throw new Error(`STAGING_INPUTS_INVALID: ${problems.join(", ")}`);
}
export function runId(env: Environment = process.env): string {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const id =
    env.GITHUB_ACTIONS === "true"
      ? `gh-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}-${suffix}`
      : `local-${Date.now().toString(36)}-${suffix}`;
  if (!RUN_ID.test(id)) throw new Error("STAGING_RUN_ID_INVALID");
  return id;
}

/** Only exact staging internal fixture commands, with no inherited credentials. */
export function convexRun<T>(
  fn: string,
  args: Record<string, unknown>,
  env: Environment = process.env,
): T {
  assertStagingInputs(env);
  if (
    !/^staging\/e2eFixture:(prepare|identityStatus|cleanup|cleanupPartial|staleRuns)$/.test(
      fn,
    )
  )
    throw new Error("STAGING_CONVEX_FUNCTION_REFUSED");
  // An explicit, private env file makes Convex select/authenticate the same
  // reviewed deployment and prevents loading ambient .env/.env.local targets.
  // Fully qualified --deployment selectors bypass deploy-key auth in CLI 1.46.
  const directory = mkdtempSync(join(tmpdir(), "industrial-staging-command-"));
  const envFile = join(directory, "deployment.env");
  chmodSync(directory, 0o700);
  try {
    writeFileSync(envFile, `CONVEX_DEPLOY_KEY='${env.CONVEX_DEPLOY_KEY}'\n`, {
      flag: "wx",
      mode: 0o600,
    });
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "convex",
        "run",
        "--env-file",
        envFile,
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
        fn,
        JSON.stringify(args),
      ],
      {
        encoding: "utf8",
        env: {
          PATH: env.PATH,
          HOME: env.HOME,
          TMPDIR: env.TMPDIR,
          CI: "1",
          NODE_ENV: "test",
        },
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (result.status !== 0 || result.error)
      throw new Error("STAGING_CONVEX_COMMAND_FAILED");
    try {
      return JSON.parse(result.stdout.trim()) as T;
    } catch {
      throw new Error("STAGING_CONVEX_RESULT_INVALID");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function validateState(value: unknown): StagingFixtureState {
  if (value === null || typeof value !== "object")
    throw new Error("STAGING_OWNERSHIP_STATE_INVALID");
  const state = value as StagingFixtureState;
  if (
    state.version !== 1 ||
    state.repository !== STAGING.repository ||
    state.clerkInstanceId !== STAGING.clerkInstanceId ||
    typeof state.runId !== "string" ||
    !RUN_ID.test(state.runId) ||
    state.managerEmail !== managerEmail(state.runId)
  )
    throw new Error("STAGING_OWNERSHIP_STATE_INVALID");
  if (
    state.pendingCreation !== undefined &&
    !["user", "primary", "other"].includes(state.pendingCreation)
  )
    throw new Error("STAGING_OWNERSHIP_STATE_INVALID");
  for (const [key, prefix] of [
    ["clerkUserId", "user_"],
    ["clerkOrganizationId", "org_"],
    ["otherClerkOrganizationId", "org_"],
    ["clerkMembershipId", "orgmem_"],
  ] as const) {
    if (
      state[key] !== undefined &&
      (typeof state[key] !== "string" ||
        !new RegExp(`^${prefix}[A-Za-z0-9_-]+$`).test(state[key]!))
    )
      throw new Error("STAGING_OWNERSHIP_STATE_INVALID");
  }
  if (
    state.clerkOrganizationId !== undefined &&
    state.clerkOrganizationId === state.otherClerkOrganizationId
  )
    throw new Error("STAGING_OWNERSHIP_STATE_INVALID");
  for (const key of [
    "runWarehouseId",
    "forbiddenWarehouseId",
    "otherTenantWarehouseId",
  ] as const) {
    if (
      state[key] !== undefined &&
      (typeof state[key] !== "string" || !/^[a-z0-9]+$/.test(state[key]!))
    )
      throw new Error("STAGING_OWNERSHIP_STATE_INVALID");
  }
  if (
    state.deleted !== undefined &&
    (typeof state.deleted !== "object" ||
      state.deleted === null ||
      Object.entries(state.deleted).some(
        ([key, flag]) =>
          !["primary", "other", "user"].includes(key) ||
          typeof flag !== "boolean",
      ))
  )
    throw new Error("STAGING_OWNERSHIP_STATE_INVALID");
  return state;
}
function assertPrivateFile(path: string) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid !== undefined && stat.uid !== process.getuid())
  )
    throw new Error("STAGING_OWNERSHIP_STATE_NOT_PRIVATE");
}
export function writeFixtureState(
  state: StagingFixtureState,
  path = FIXTURE_STATE,
): void {
  validateState(state);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
    throw new Error("STAGING_OWNERSHIP_DIRECTORY_INVALID");
  chmodSync(directory, 0o700);
  if (existsSync(path)) assertPrivateFile(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(fd, `${JSON.stringify(state)}\n`);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}
export function readFixtureState(path = FIXTURE_STATE): StagingFixtureState {
  try {
    assertPrivateFile(path);
    return validateState(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new Error("STAGING_OWNERSHIP_STATE_INVALID_OR_NOT_PRIVATE");
  }
}
export function readReadyFixtureState(path = FIXTURE_STATE): ReadyFixtureState {
  const state = readFixtureState(path);
  const required: readonly ReadyKeys[] = [
    "clerkUserId",
    "clerkOrganizationId",
    "otherClerkOrganizationId",
    "clerkMembershipId",
    "runWarehouseId",
    "forbiddenWarehouseId",
    "otherTenantWarehouseId",
  ];
  if (
    required.some((key) => !state[key]) ||
    Object.values(state.deleted ?? {}).some(Boolean)
  )
    throw new Error("STAGING_FIXTURE_NOT_READY");
  return state as ReadyFixtureState;
}
export function ownershipArgs(state: StagingFixtureState) {
  return {
    confirmation: STAGING.confirmation,
    runId: state.runId,
    ...(state.clerkOrganizationId === undefined
      ? {}
      : { clerkOrganizationId: state.clerkOrganizationId }),
    ...(state.otherClerkOrganizationId === undefined
      ? {}
      : { otherClerkOrganizationId: state.otherClerkOrganizationId }),
    ...(state.clerkUserId === undefined
      ? {}
      : { clerkUserId: state.clerkUserId }),
    ...(state.clerkMembershipId === undefined
      ? {}
      : { clerkMembershipId: state.clerkMembershipId }),
  };
}
export function ownershipMetadata(
  runId: string,
  kind: "user" | "primary" | "other",
) {
  return {
    ciE2eRun: runId,
    ciE2eRepository: STAGING.repository,
    ciE2eInstance: STAGING.clerkInstanceId,
    ciE2eKind: kind,
  };
}
function ownsMetadata(
  metadata: Record<string, unknown>,
  runId: string,
  kind: "user" | "primary" | "other",
) {
  return Object.entries(ownershipMetadata(runId, kind)).every(
    ([key, value]) => metadata[key] === value,
  );
}
type ClerkClient = ReturnType<typeof createClerkClient>;
export interface OwnedUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  externalId: string | null;
  emailAddresses: { emailAddress: string }[];
  privateMetadata: Record<string, unknown>;
}
export interface OwnedOrganization {
  id: string;
  name: string;
  slug: string | null;
  privateMetadata: Record<string, unknown>;
}
export interface StagingClerkPort {
  instance: { get: () => Promise<{ id: string; environmentType: string }> };
  users: {
    createUser: (
      args: Parameters<ClerkClient["users"]["createUser"]>[0],
    ) => Promise<OwnedUser>;
    getUser: (id: string) => Promise<OwnedUser>;
    getUserList: (args: {
      emailAddress: string[];
      limit: number;
    }) => Promise<{ data: OwnedUser[]; totalCount: number }>;
    deleteUser: (id: string) => Promise<unknown>;
  };
  organizations: {
    createOrganization: (
      args: Parameters<ClerkClient["organizations"]["createOrganization"]>[0],
    ) => Promise<OwnedOrganization>;
    getOrganization: (args: {
      organizationId: string;
    }) => Promise<OwnedOrganization>;
    getOrganizationList: (args: {
      query: string;
      limit: number;
    }) => Promise<{ data: OwnedOrganization[]; totalCount: number }>;
    deleteOrganization: (id: string) => Promise<unknown>;
    deleteOrganizationMembership: (args: {
      organizationId: string;
      userId: string;
    }) => Promise<{ id: string }>;
    getOrganizationMembershipList: (args: {
      organizationId: string;
      userId: string[];
      limit: number;
    }) => Promise<{
      data: {
        id: string;
        organization: { id: string };
        publicUserData?: { userId: string } | null | undefined;
      }[];
      totalCount: number;
    }>;
  };
}
export function stagingClerk(env: Environment = process.env): StagingClerkPort {
  assertStagingInputs(env);
  return createClerkClient({
    secretKey: env.CLERK_SECRET_KEY!,
    publishableKey: stagingPublishableKey(),
    apiUrl: "https://api.clerk.com",
    telemetry: { disabled: true },
  });
}
export async function verifyStagingInstance(clerk: StagingClerkPort) {
  const instance = await clerk.instance.get();
  if (
    instance.id !== STAGING.clerkInstanceId ||
    instance.environmentType !== "development"
  )
    throw new Error("STAGING_CLERK_INSTANCE_REFUSED");
}
export function assertOwnedUser(user: OwnedUser, state: StagingFixtureState) {
  if (
    user.id !== state.clerkUserId ||
    user.firstName !== `CI E2E ${state.runId}` ||
    user.lastName !== "actor" ||
    user.externalId !== `ci-e2e:${STAGING.repository}:${state.runId}:actor` ||
    user.emailAddresses.length !== 1 ||
    user.emailAddresses[0]?.emailAddress !== state.managerEmail ||
    !ownsMetadata(user.privateMetadata, state.runId, "user")
  )
    throw new Error("STAGING_USER_OWNERSHIP_REFUSED");
}
export function assertOwnedOrganization(
  org: OwnedOrganization,
  state: StagingFixtureState,
  kind: "primary" | "other",
) {
  if (
    org.id !==
      (kind === "primary"
        ? state.clerkOrganizationId
        : state.otherClerkOrganizationId) ||
    org.name !== organizationName(state.runId, kind) ||
    !ownsMetadata(org.privateMetadata, state.runId, kind)
  )
    throw new Error("STAGING_ORGANIZATION_OWNERSHIP_REFUSED");
}
export function isNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}
