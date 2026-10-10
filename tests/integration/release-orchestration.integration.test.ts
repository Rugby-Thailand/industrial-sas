import { describe, expect, it } from "vitest";

import { loadTargets } from "../../scripts/release/lib/env-contract.mjs";
import {
  buildManifest,
  summaryMarkdown,
} from "../../scripts/release/lib/manifest.mjs";
import {
  OUTCOMES,
  runRelease,
  vercelDeployArgs,
} from "../../scripts/release/lib/release.mjs";
import { summarizePlaywrightReport } from "../../scripts/release/lib/smoke-report.mjs";
import {
  GATED_BUILD_COMMAND,
  cutoverState,
  gatedVercelConfig,
} from "../../scripts/release/lib/vercel-config.mjs";
import { createVercelApi } from "../../scripts/release/lib/vercel-api.mjs";

/**
 * Release orchestration against fake Vercel/GitHub/Playwright dependencies.
 * No network, CLI or cloud call happens in this file.
 */

const targets = loadTargets();
const SHA = "a".repeat(40);
const NEWER = "b".repeat(40);
const PREVIOUS = "dpl_previous";
const CANDIDATE = "dpl_candidate";

type Deployment = {
  id: string;
  url: string;
  projectId: string;
  target: string | null;
  readyState: string;
  createdAt: number;
  meta: Record<string, string>;
};

interface WorldOptions {
  targetName?: "production" | "staging";
  mainSha?: string | (() => string);
  buildStates?: string[];
  extraDeployments?: Partial<Deployment>[];
  candidateMeta?: Record<string, string>;
  candidateTarget?: string | null;
  smoke?:
    Record<string, unknown> | ((phase: string) => Record<string, unknown>);
  deployThrows?: boolean;
  promoteMovesServing?: boolean;
  servingChangesBeforePromote?: boolean;
  projectName?: string;
  accountId?: string | null;
  candidateProjectId?: string | null;
  aliasDeploymentId?: string;
  aliasProjectId?: string;
  aliasRedirect?: string;
  backupResult?: unknown;
  backupThrows?: boolean;
  committedVercelConfig?: unknown;
  acknowledged?: string[];
  stagingAliasNever?: boolean;
}

function backupEvidence(deploymentName: string, now = 1_000_000) {
  return {
    ok: true,
    metadata: {
      schema: 1,
      deploymentName,
      requestor: "snapshotExport",
      state: "completed",
      includeStorage: true,
      requestedAtMs: now,
      verifiedAtMs: now,
      startTs: String(now * 1_000_000),
      completeTs: String(now * 1_000_000),
      expirationTs: String((now + 14 * 86_400_000) * 1_000_000),
      sizeBytes: "100",
    },
  };
}

function world(options: WorldOptions = {}) {
  const targetName = options.targetName ?? "production";
  const target = targets.targets[targetName];
  let now = 1_000_000;
  let serving = PREVIOUS;
  const calls: string[] = [];
  const buildStates = [...(options.buildStates ?? ["BUILDING", "READY"])];
  const deployments = new Map<string, Deployment>();
  const add = (deployment: Deployment) =>
    deployments.set(deployment.id, deployment);
  add({
    id: PREVIOUS,
    url: "previous.vercel.app",
    projectId: target.vercelProjectId,
    target: "production",
    readyState: "READY",
    createdAt: 500,
    meta: {},
  });
  for (const extra of options.extraDeployments ?? []) {
    add({
      url: `${extra.id}.vercel.app`,
      projectId: target.vercelProjectId,
      target: "production",
      readyState: "READY",
      createdAt: 900,
      meta: {},
      ...extra,
    } as Deployment);
  }
  let deployCount = 0;
  let aliasDeploymentId = PREVIOUS;

  const api = {
    async getProject(id: string) {
      calls.push(`getProject:${id}`);
      if (options.servingChangesBeforePromote && deployCount > 0)
        serving = "dpl_other";
      return {
        id,
        name: options.projectName ?? target.vercelProjectName,
        accountId:
          options.accountId === undefined
            ? target.vercelTeamId
            : options.accountId,
        targets: { production: { id: serving } },
      };
    },
    async listProductionDeployments() {
      calls.push("list");
      return [...deployments.values()];
    },
    async getDeployment(idOrHost: string) {
      calls.push(`get:${idOrHost}`);
      const found =
        deployments.get(idOrHost) ??
        [...deployments.values()].find((d) => d.url === idOrHost);
      if (!found) throw new Error("not found");
      if (found.id === CANDIDATE && buildStates.length > 0) {
        found.readyState = buildStates.shift()!;
      }
      return { ...found };
    },
    async assignAlias(id: string, host: string) {
      calls.push(`alias:${id}:${host}`);
      aliasDeploymentId = options.aliasDeploymentId ?? id;
      return 200;
    },
    async getAlias(host: string) {
      calls.push(`getAlias:${host}`);
      return {
        alias: host,
        deploymentId: aliasDeploymentId,
        projectId: options.aliasProjectId ?? target.vercelProjectId,
        ...(options.aliasRedirect === undefined
          ? {}
          : { redirect: options.aliasRedirect }),
      };
    },
    async promote(_projectId: string, id: string) {
      calls.push(`promote:${id}`);
      if (options.promoteMovesServing !== false) serving = id;
      return 200;
    },
    async rollback() {
      throw new Error("rollback is never automatic");
    },
  };

  const deps = {
    api,
    async currentMainSha() {
      calls.push("main");
      const value = options.mainSha ?? SHA;
      return typeof value === "function" ? value() : value;
    },
    async backup() {
      calls.push("backup");
      if (options.backupThrows) throw new Error("Bearer secret-provider-error");
      return options.backupResult === undefined
        ? backupEvidence(target.convexDeployment, now)
        : options.backupResult;
    },
    async deploy({ sha, runId }: { sha: string; runId: string }) {
      calls.push(`deploy:${sha}:${runId}`);
      deployCount += 1;
      if (options.deployThrows) throw new Error("upload failed");
      add({
        id: CANDIDATE,
        url: "candidate-abc.vercel.app",
        projectId:
          options.candidateProjectId === undefined
            ? target.vercelProjectId
            : (options.candidateProjectId ?? ""),
        target:
          options.candidateTarget === undefined
            ? "production"
            : options.candidateTarget,
        readyState: "QUEUED",
        createdAt: 2_000,
        meta: options.candidateMeta ?? { releaseSha: sha, releaseRunId: runId },
      });
      if (targetName === "staging" && !options.stagingAliasNever) {
        // --prod without --skip-domain: Vercel assigns the alias on READY.
        const original = api.getProject;
        api.getProject = async (id: string) => {
          const project = await original(id);
          const candidate = deployments.get(CANDIDATE);
          return candidate?.readyState === "READY"
            ? { ...project, targets: { production: { id: CANDIDATE } } }
            : project;
        };
      }
      return "https://candidate-abc.vercel.app\n";
    },
    async smoke({ phase, baseUrl }: { phase: string; baseUrl?: string }) {
      calls.push(`smoke:${phase}`);
      calls.push(`smokeUrl:${phase}:${baseUrl}`);
      const result =
        typeof options.smoke === "function"
          ? options.smoke(phase)
          : (options.smoke ?? { ok: true, passed: 5, failed: 0, skipped: 0 });
      return result;
    },
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    },
  };

  const input = {
    targetName,
    target,
    repository: targets.repository,
    expectedRepository: targets.repository,
    ref: "refs/heads/main",
    sha: SHA,
    runId: "123456",
    runUrl: "https://github.com/x/y/actions/runs/123456",
    committedVercelConfig:
      options.committedVercelConfig === undefined
        ? gatedVercelConfig()
        : options.committedVercelConfig,
    acknowledgedDeploymentIds: options.acknowledged ?? [],
    limits: {
      buildTimeoutMs: 60_000,
      promoteTimeoutMs: 30_000,
      pollIntervalMs: 10_000,
    },
  };
  return { input, deps, calls };
}

const run = async (options: WorldOptions = {}) => {
  const { input, deps, calls } = world(options);
  const result = await runRelease(input, deps);
  return { result, calls, input };
};

describe("gated production release", () => {
  it("builds, smoke-tests and promotes the same candidate, then verifies live", async () => {
    const { result, calls } = await run();
    expect(result).toMatchObject({
      code: "RELEASED",
      ok: true,
      mutation: "frontend",
    });
    expect(calls.filter((call) => call.startsWith("deploy:"))).toEqual([
      `deploy:${SHA}:123456`,
    ]);
    expect(calls.indexOf("smoke:candidate")).toBeLessThan(
      calls.indexOf(`promote:${CANDIDATE}`),
    );
    expect(calls.indexOf(`promote:${CANDIDATE}`)).toBeLessThan(
      calls.indexOf("smoke:live"),
    );
    expect(result.state).toMatchObject({
      previousDeploymentId: PREVIOUS,
      deploymentId: CANDIDATE,
    });
  });

  it("requires backup completion before any deployment and keeps only safe evidence", async () => {
    const { input, deps, calls } = world();
    const nativeResult = backupEvidence(input.target.convexDeployment);
    deps.backup = async () => {
      calls.push("backup");
      return {
        ...nativeResult,
        metadata: {
          ...nativeResult.metadata,
          archiveUrl: "secret-archive-url",
        },
        rawError: "Bearer secret",
      };
    };
    const result = await runRelease(input, deps);
    expect(result.code).toBe("RELEASED");
    expect(calls.lastIndexOf("backup")).toBeLessThan(
      calls.findIndex((call) => call.startsWith("deploy:")),
    );
    expect(result.state.checks.backup).toMatchObject({
      ok: true,
      metadata: { includeStorage: true, deploymentName: "greedy-cardinal-537" },
    });
    expect(JSON.stringify(buildManifest(result, input))).not.toMatch(
      /secret|archiveUrl|rawError/,
    );
  });

  it("refuses deployment on absent, failed, malformed or throwing backup hooks", async () => {
    for (const options of [
      { backupResult: { ok: false, reason: "Bearer secret" } },
      { backupResult: { ok: true } },
      { backupThrows: true },
    ]) {
      const { result, calls } = await run(options);
      expect(result).toMatchObject({
        code: "BACKUP_FAILED",
        mutation: "none",
        ok: false,
      });
      expect(calls.some((call) => call.startsWith("deploy:"))).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(
        /Bearer|secret-provider-error/,
      );
    }
    const { input, deps, calls } = world();
    const { backup: unusedBackup, ...withoutBackup } = deps;
    void unusedBackup;
    const result = await runRelease(input, withoutBackup);
    expect(result).toMatchObject({ code: "BACKUP_FAILED", mutation: "none" });
    expect(calls.some((call) => call.startsWith("deploy:"))).toBe(false);
  });

  it("binds the exact candidate ID before testing the production-compatible host", async () => {
    const { result, calls } = await run();
    expect(result.code).toBe("RELEASED");
    expect(calls).toContain(
      `alias:${CANDIDATE}:ci-candidate.thaipropertyai.com`,
    );
    expect(
      calls.indexOf("getAlias:ci-candidate.thaipropertyai.com"),
    ).toBeLessThan(calls.indexOf("smoke:candidate"));
    expect(calls).toContain(
      "smokeUrl:candidate:https://ci-candidate.thaipropertyai.com",
    );
    expect(
      calls.some((call) =>
        call.startsWith("smokeUrl:candidate:https://candidate-abc.vercel.app"),
      ),
    ).toBe(false);
  });

  it("does not test or promote a stale, cross-project or redirecting candidate alias", async () => {
    for (const options of [
      { aliasDeploymentId: PREVIOUS },
      { aliasProjectId: "prj_elsewhere" },
      { aliasRedirect: "other.example" },
      { aliasDeploymentId: "invalid" },
    ]) {
      const { result, calls } = await run(options);
      expect(result).toMatchObject({
        code: "CANDIDATE_FAILED",
        mutation: "backend",
      });
      expect(calls).not.toContain("smoke:candidate");
      expect(calls.some((call) => call.startsWith("promote:"))).toBe(false);
    }
  });

  it("rejects missing account provenance and missing candidate project provenance", async () => {
    for (const accountId of [null, "team_elsewhere"]) {
      const { result, calls } = await run({ accountId });
      expect(result).toMatchObject({ code: "NOT_READY", mutation: "none" });
      expect(calls).not.toContain("backup");
    }
    for (const candidateProjectId of [null, "prj_elsewhere"]) {
      const { result, calls } = await run({ candidateProjectId });
      expect(result).toMatchObject({
        code: "VERIFY_FAILED",
        mutation: "backend",
      });
      expect(calls.some((call) => call.startsWith("alias:"))).toBe(false);
    }
  });

  it("refuses unknown, duplicate or cross-project inventory before backup/deploy", async () => {
    for (const extras of [
      [{ id: "dpl_unknown", readyState: "UNKNOWN" }],
      [{ id: "dpl_wrong", projectId: "prj_elsewhere" }],
      [{ id: "dpl_bad_time", createdAt: Number.NaN }],
      [{ id: "dpl_bad_id/secret" }],
    ]) {
      const { result, calls } = await run({ extraDeployments: extras });
      expect(result).toMatchObject({ code: "NOT_READY", mutation: "none" });
      expect(calls).not.toContain("backup");
      expect(calls.some((call) => call.startsWith("deploy:"))).toBe(false);
    }
    const { input, deps, calls } = world();
    const list = deps.api.listProductionDeployments;
    deps.api.listProductionDeployments = async () => {
      const rows = await list();
      return [...rows, rows[0]!];
    };
    expect((await runRelease(input, deps)).code).toBe("NOT_READY");
    expect(calls).not.toContain("backup");
  });

  it("refuses promotion when another production build appears during candidate testing", async () => {
    const { input, deps, calls } = world();
    const list = deps.api.listProductionDeployments;
    deps.api.listProductionDeployments = async () => {
      const rows = await list();
      return calls.includes("smoke:candidate")
        ? [
            ...rows,
            {
              ...rows[0]!,
              id: "dpl_external",
              readyState: "BUILDING",
              createdAt: 3000,
            },
          ]
        : rows;
    };
    const result = await runRelease(input, deps);
    expect(result).toMatchObject({ code: "CONFLICT", mutation: "backend" });
    expect(calls.some((call) => call.startsWith("promote:"))).toBe(false);
  });

  it("masks provider errors and preserves mutation phases through promotion and live failures", async () => {
    const marker = "Bearer private-provider-message";
    for (const phase of ["deploy", "alias", "promote", "live"] as const) {
      const { input, deps } = world();
      if (phase === "deploy")
        deps.deploy = async () => {
          throw new Error(marker);
        };
      if (phase === "alias")
        deps.api.assignAlias = async () => {
          throw new Error(marker);
        };
      if (phase === "promote")
        deps.api.promote = async () => {
          throw new Error(marker);
        };
      if (phase === "live") {
        const smoke = deps.smoke;
        deps.smoke = async (request) => {
          if (request.phase === "live") throw new Error(marker);
          return smoke(request);
        };
      }
      const result = await runRelease(input, deps);
      const expected = {
        deploy: ["DEPLOY_COMMAND_FAILED", "backend-possible"],
        alias: ["CANDIDATE_FAILED", "backend"],
        promote: ["PROMOTE_FAILED", "frontend-possible"],
        live: ["LIVE_FAILED", "frontend"],
      }[phase];
      expect(result.code).toBe(expected[0]);
      expect(result.mutation).toBe(expected[1]);
      const manifest = buildManifest(result, input);
      expect(
        JSON.stringify(result) +
          JSON.stringify(manifest) +
          summaryMarkdown(manifest),
      ).not.toContain(marker);
      if (phase === "promote")
        expect(manifest.recovery).toContain("may have completed");
      if (phase === "live") expect(manifest.recovery).toContain("new frontend");
    }
  });

  it("fails closed instead of reusing prior state when deployment polling becomes malformed", async () => {
    for (const malformed of [
      null,
      {
        id: "dpl_changed",
        readyState: "READY",
        createdAt: 2000,
        url: "candidate-abc.vercel.app",
      },
    ]) {
      const { input, deps, calls } = world();
      const read = deps.api.getDeployment;
      const api = {
        ...deps.api,
        getDeployment: async (id: string) =>
          id === CANDIDATE ? malformed : read(id),
      };
      const result = await runRelease(input, { ...deps, api });
      expect(result).toMatchObject({
        code: "BUILD_FAILED",
        mutation: "backend-possible",
      });
      expect(result.state.deploymentId).toBe(CANDIDATE);
      expect(calls.some((call) => call.startsWith("promote:"))).toBe(false);
    }
  });

  it("records monotonic mutation evidence and preserves confirmed serving state after callback failure", async () => {
    const { input, deps } = world();
    const result = await runRelease(input, {
      ...deps,
      onEvent: (event: { step: string }) => {
        if (event.step === "serving") throw new Error("Bearer secret-callback");
      },
    });
    expect(result).toMatchObject({
      code: "PROMOTE_FAILED",
      mutation: "frontend",
    });
    const levels = [
      "none",
      "backend-possible",
      "backend",
      "frontend-possible",
      "frontend",
    ];
    const mutations = result.events.map((event: { mutation: string }) =>
      levels.indexOf(event.mutation),
    );
    expect(mutations).toEqual([...mutations].sort((a, b) => a - b));
    expect(JSON.stringify(buildManifest(result, input))).not.toContain(
      "secret-callback",
    );
    expect(buildManifest(result, input).recovery).toContain("new frontend");
  });

  it("does not copy smoke messages or arbitrary optional-check labels into public evidence", async () => {
    const { result, input } = await run({
      smoke: {
        ok: false,
        passed: 1,
        failed: 1,
        summary: "Bearer secret",
        notConfigured: ["secret-provider-message"],
      },
    });
    expect(result.code).toBe("CANDIDATE_FAILED");
    expect(JSON.stringify(buildManifest(result, input))).not.toMatch(
      /Bearer|secret-provider-message/,
    );
  });

  it("refuses before any mutation until the cutover is committed", async () => {
    for (const committed of [
      null,
      { ignoreCommand: "node scripts/vercel-ignore-build.mjs" },
      { ...gatedVercelConfig(), git: { deploymentEnabled: { main: true } } },
      { ...gatedVercelConfig(), buildCommand: "pnpm build" },
      { ...gatedVercelConfig(), ignoreCommand: "exit 0" },
    ]) {
      const { result, calls } = await run({ committedVercelConfig: committed });
      expect(result.code).toBe("NOT_READY");
      expect(result.mutation).toBe("none");
      expect(calls.some((call) => call.startsWith("deploy:"))).toBe(false);
    }
  });

  it("records a stale SHA as superseded and never builds it", async () => {
    const { result, calls } = await run({ mainSha: NEWER });
    expect(result).toMatchObject({
      code: "SUPERSEDED",
      ok: true,
      mutation: "none",
    });
    expect(calls.some((call) => call.startsWith("deploy:"))).toBe(false);
  });

  it("refuses a non-main ref, wrong repository or malformed SHA", async () => {
    for (const patch of [
      { ref: "refs/heads/feature" },
      { repository: "someone/fork" },
      { sha: "abc" },
    ]) {
      const { input, deps, calls } = world();
      const result = await runRelease({ ...input, ...patch }, deps);
      expect(result.code).toBe("NOT_READY");
      expect(calls).toEqual([]);
    }
  });

  it("refuses when the Vercel project identity does not match", async () => {
    const { result, calls } = await run({ projectName: "someone-else" });
    expect(result.code).toBe("NOT_READY");
    expect(calls.some((call) => call.startsWith("deploy:"))).toBe(false);
  });

  it("blocks on an in-flight production build outside this lock", async () => {
    const { result, calls } = await run({
      extraDeployments: [{ id: "dpl_git_build", readyState: "BUILDING" }],
    });
    expect(result.code).toBe("BLOCKED_IN_FLIGHT");
    expect(calls.some((call) => call.startsWith("deploy:"))).toBe(false);
  });

  it("blocks on an orphaned newer deployment until it is acknowledged", async () => {
    const orphan = { id: "dpl_orphan", readyState: "READY", createdAt: 900 };
    const blocked = await run({ extraDeployments: [orphan] });
    expect(blocked.result.code).toBe("BLOCKED_UNRECONCILED");
    expect(blocked.result.reason).toContain("dpl_orphan");

    const failedBuild = await run({
      extraDeployments: [{ ...orphan, id: "dpl_errored", readyState: "ERROR" }],
    });
    expect(failedBuild.result.code).toBe("BLOCKED_UNRECONCILED");

    const acknowledged = await run({
      extraDeployments: [orphan],
      acknowledged: ["dpl_orphan"],
    });
    expect(acknowledged.result.code).toBe("RELEASED");

    // Older than the serving deployment: history, not an orphan.
    const older = await run({
      extraDeployments: [{ ...orphan, createdAt: 100 }],
    });
    expect(older.result.code).toBe("RELEASED");
  });

  it("classifies a deploy command failure as a possible backend mutation", async () => {
    const { result } = await run({ deployThrows: true });
    expect(result).toMatchObject({
      code: "DEPLOY_COMMAND_FAILED",
      mutation: "backend-possible",
    });
  });

  it("fails a build that errors and never promotes it", async () => {
    const { result, calls } = await run({ buildStates: ["BUILDING", "ERROR"] });
    expect(result).toMatchObject({
      code: "BUILD_FAILED",
      mutation: "backend-possible",
    });
    expect(result.state.deploymentId).toBe(CANDIDATE);
    expect(calls.some((call) => call.startsWith("promote:"))).toBe(false);
  });

  it("bounds polling and reports an uncertain build at the deadline", async () => {
    const { result } = await run({ buildStates: Array(20).fill("BUILDING") });
    expect(result.code).toBe("BUILD_TIMEOUT");
    expect(result.reason).toContain("Reconcile");
    expect(result.state.deploymentId).toBe(CANDIDATE);
  });

  it("rejects a candidate whose provenance or target does not match", async () => {
    for (const options of [
      { candidateMeta: { releaseSha: NEWER, releaseRunId: "123456" } },
      { candidateMeta: { releaseSha: SHA } },
      {
        candidateMeta: {
          releaseSha: SHA,
          releaseRunId: "123456",
          githubCommitSha: NEWER,
        },
      },
      { candidateTarget: null },
      {
        candidateMeta: {
          releaseSha: SHA,
          releaseRunId: "123456",
          githubCommitSha: "malformed",
        },
      },
    ]) {
      const { result, calls } = await run(options);
      expect(result.code).toBe("VERIFY_FAILED");
      expect(result.mutation).toBe("backend");
      expect(calls.some((call) => call.startsWith("promote:"))).toBe(false);
    }
  });

  it("does not promote when candidate smoke fails, ran nothing, or skipped a required check", async () => {
    for (const smoke of [
      { ok: false, passed: 3, failed: 1 },
      { ok: true, passed: 0, failed: 0 },
      { ok: true, passed: 3, failed: 0, skippedRequired: 1 },
      { ok: true, passed: 3, failed: 2 },
    ]) {
      const { result, calls } = await run({ smoke });
      expect(result.code).toBe("CANDIDATE_FAILED");
      expect(result.mutation).toBe("backend");
      expect(calls.some((call) => call.startsWith("promote:"))).toBe(false);
    }
  });

  it("does not promote over a serving deployment that changed during the build", async () => {
    const { result, calls } = await run({ servingChangesBeforePromote: true });
    expect(result.code).toBe("CONFLICT");
    expect(calls.some((call) => call.startsWith("promote:"))).toBe(false);
  });

  it("supersedes after the backup when main advanced before deployment", async () => {
    let lookups = 0;
    const { result, calls } = await run({
      mainSha: () => (++lookups === 1 ? SHA : NEWER),
    });
    expect(result).toMatchObject({ code: "SUPERSEDED", mutation: "none" });
    expect(calls).toContain("backup");
    expect(calls.some((call) => call.startsWith("deploy:"))).toBe(false);
  });

  it("finishes an already started release when main advances during its build", async () => {
    const { input, deps, calls } = world();
    let main = SHA;
    deps.currentMainSha = async () => {
      calls.push("main");
      return main;
    };
    const originalDeploy = deps.deploy;
    deps.deploy = async (provenance) => {
      main = NEWER;
      return originalDeploy(provenance);
    };
    const result = await runRelease(input, deps);
    expect(result.code).toBe("RELEASED");
    expect(calls).toContain(`promote:${CANDIDATE}`);
    expect(calls.filter((call) => call === "main")).toHaveLength(2);
  });

  it("reports a promotion that never takes effect within the bound", async () => {
    const { result } = await run({ promoteMovesServing: false });
    expect(result).toMatchObject({
      code: "PROMOTE_TIMEOUT",
      mutation: "frontend-possible",
    });
  });

  it("marks a live failure for operator recovery without rolling back automatically", async () => {
    const { result, calls, input } = await run({
      smoke: (phase) =>
        phase === "live"
          ? { ok: false, passed: 2, failed: 1 }
          : { ok: true, passed: 4, failed: 0 },
    });
    expect(result).toMatchObject({ code: "LIVE_FAILED", mutation: "frontend" });
    expect(calls.some((call) => call.startsWith("rollback"))).toBe(false);
    const manifest = buildManifest(result, input);
    expect(manifest.recovery).toContain("rollback");
    expect(manifest.vercel.previousDeploymentId).toBe(PREVIOUS);
  });
});

describe("gated staging deployment", () => {
  it("deploys with the stable alias, waits until it serves, then runs the staging suite", async () => {
    const { result, calls } = await run({ targetName: "staging" });
    expect(result).toMatchObject({ code: "STAGING_PASSED", ok: true });
    expect(calls).toContain("smoke:staging");
    expect(calls.some((call) => call.startsWith("promote:"))).toBe(false);
    expect(calls).not.toContain("backup");
  });

  it("does not need the production cutover and is not blocked by old failed builds", async () => {
    const { result } = await run({
      targetName: "staging",
      committedVercelConfig: null,
      extraDeployments: [
        { id: "dpl_old_error", readyState: "ERROR", createdAt: 900 },
      ],
    });
    expect(result.code).toBe("STAGING_PASSED");
  });

  it("fails when any required staging check was skipped", async () => {
    const { result } = await run({
      targetName: "staging",
      smoke: { ok: true, passed: 9, failed: 0, skipped: 1, skippedRequired: 1 },
    });
    expect(result.code).toBe("STAGING_FAILED");
  });

  it("fails when the alias never moves to the new deployment", async () => {
    const { result } = await run({
      targetName: "staging",
      stagingAliasNever: true,
    });
    expect(result.ok).toBe(false);
  });
});

describe("release configuration", () => {
  it("uses a gated build that validates before Convex pushes", () => {
    expect(GATED_BUILD_COMMAND.indexOf("--phase=pre")).toBeLessThan(
      GATED_BUILD_COMMAND.indexOf("convex deploy"),
    );
    expect(GATED_BUILD_COMMAND).toMatch(
      /--cmd 'node scripts\/release\/assert-deploy-env\.mjs --phase=build && pnpm build'/,
    );
    expect(GATED_BUILD_COMMAND).not.toMatch(
      /allow-deleting-large-indexes|--preview/,
    );
    expect(cutoverState(gatedVercelConfig()).ready).toBe(true);
  });

  it("uses the committed gated configuration with all native Git builds retired", async () => {
    const { readFileSync } = await import("node:fs");
    const committed = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(cutoverState(committed)).toMatchObject({ ready: true });
  });

  it("passes provenance and never assigns domains on production deploys", () => {
    const production = vercelDeployArgs({
      sha: SHA,
      runId: "1",
      skipDomain: true,
    });
    expect(production).toEqual(
      expect.arrayContaining([
        "--prod",
        "--skip-domain",
        "--no-wait",
        `releaseSha=${SHA}`,
      ]),
    );
    expect(production).not.toContain("--prebuilt");
    expect(
      vercelDeployArgs({ sha: SHA, runId: "1", skipDomain: false }),
    ).not.toContain("--skip-domain");
  });

  it("assigns every outcome an explicit mutation level", () => {
    for (const outcome of Object.values(OUTCOMES)) {
      expect([
        "none",
        "backend-possible",
        "backend",
        "frontend-possible",
        "frontend",
      ]).toContain(outcome.mutation);
    }
  });
});

describe("smoke report interpretation", () => {
  const report = (
    tests: { status: string; annotations?: { type: string }[] }[],
  ) => ({
    suites: [
      {
        title: "smoke.spec.ts",
        specs: tests.map((test, index) => ({
          title: `case ${index}`,
          tests: [{ status: test.status, annotations: test.annotations ?? [] }],
        })),
      },
    ],
    errors: [],
  });

  it("counts only expected results as passed", () => {
    expect(
      summarizePlaywrightReport(report([{ status: "expected" }])),
    ).toMatchObject({
      ok: true,
      passed: 1,
    });
    expect(
      summarizePlaywrightReport(
        report([{ status: "expected" }, { status: "flaky" }]),
      ),
    ).toMatchObject({ ok: false, failed: 1 });
  });

  it("treats an unannotated skip as a missing required check", () => {
    expect(
      summarizePlaywrightReport(
        report([{ status: "expected" }, { status: "skipped" }]),
      ),
    ).toMatchObject({ ok: false, skippedRequired: 1 });
  });

  it("lists not-configured optional checks without counting them as passed", () => {
    const summary = summarizePlaywrightReport(
      report([
        { status: "expected" },
        { status: "skipped", annotations: [{ type: "not-configured" }] },
      ]),
    );
    expect(summary).toMatchObject({ ok: true, passed: 1, skippedRequired: 0 });
    expect(summary.notConfigured).toHaveLength(1);
  });

  it("fails an empty or errored report", () => {
    expect(summarizePlaywrightReport({ suites: [] }).ok).toBe(false);
    expect(
      summarizePlaywrightReport({
        ...report([{ status: "expected" }]),
        errors: [{}],
      }).ok,
    ).toBe(false);
  });
});

describe("manifest", () => {
  it("contains identifiers and outcome only", async () => {
    const { result, input } = await run();
    const manifest = buildManifest(result, input);
    const text = JSON.stringify(manifest) + summaryMarkdown(manifest);
    expect(manifest).toMatchObject({
      outcome: "RELEASED",
      sha: SHA,
      convexDeployment: "greedy-cardinal-537",
      vercel: { deploymentId: CANDIDATE, previousDeploymentId: PREVIOUS },
    });
    expect(text).not.toMatch(
      /sk_(live|test)_|pk_(live|test)_|prod:[a-z-]+\||Bearer /,
    );
  });
});

describe("Vercel API client", () => {
  it("scopes every call to the team and never leaks the token in errors", async () => {
    const seen: URL[] = [];
    const api = createVercelApi({
      token: "tok_secret_value",
      teamId: "team_abc",
      fetch: (async (url: URL, init: RequestInit) => {
        seen.push(url);
        expect((init.headers as Record<string, string>).authorization).toBe(
          "Bearer tok_secret_value",
        );
        return new Response(JSON.stringify({ error: { code: "forbidden" } }), {
          status: 403,
        });
      }) as unknown as typeof fetch,
    });
    const error = await api
      .getProject("prj_1")
      .catch((caught: unknown) => caught);
    expect(String(error)).toContain("403");
    expect(String(error)).not.toContain("forbidden");
    expect(String(error)).not.toContain("tok_secret_value");
    expect(seen[0]!.searchParams.get("teamId")).toBe("team_abc");
  });

  it("promotes through the documented project promote endpoint", async () => {
    const paths: string[] = [];
    const api = createVercelApi({
      token: "t",
      teamId: "team_abc",
      fetch: (async (url: URL, init: RequestInit) => {
        paths.push(`${init.method} ${url.pathname}`);
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
    });
    await api.promote("prj_1", "dpl_2");
    await api.rollback("prj_1", "dpl_1");
    expect(paths).toEqual([
      "POST /v10/projects/prj_1/promote/dpl_2",
      "POST /v9/projects/prj_1/rollback/dpl_1",
    ]);
  });

  it("refuses to start without a token or team", () => {
    expect(() => createVercelApi({ token: "", teamId: "team_a" })).toThrow();
    expect(() => createVercelApi({ token: "t", teamId: "" })).toThrow();
  });
});
