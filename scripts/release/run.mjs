#!/usr/bin/env node
// Gated release entrypoint, run by the `staging` and `release` jobs in
// .github/workflows/quality.yml after `check` passed for this exact commit.
//
//   node scripts/release/run.mjs --target=staging|production
//
// Inputs (environment): VERCEL_TOKEN (secret), GITHUB_TOKEN, GITHUB_REPOSITORY,
// GITHUB_REF, GITHUB_SHA, GITHUB_RUN_ID, GITHUB_SERVER_URL, and optionally
// RELEASE_ACKNOWLEDGED_DEPLOYMENTS (comma-separated reconciled IDs). Writes
// release-output/manifest.json and the job summary. Exit code 0 only when the
// release passed or was superseded by a newer main commit.
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { loadTargets } from "./lib/env-contract.mjs";
import {
  assertReleaseCheckout,
  GITHUB_MAIN_REF_URL,
  requestStagingOidc,
  smokeEnvironment,
  validateReleaseRuntime,
  validateReleaseSource,
  validateOidcLifetime,
  withStagingOidcFile,
} from "./lib/entrypoint.mjs";
import {
  runConvexBackupGate,
  validateBackupWorkflowEnvironment,
  PRODUCTION_BACKUP_TARGET,
} from "./lib/convex-backup.mjs";
import { buildManifest, summaryMarkdown } from "./lib/manifest.mjs";
import { runRelease, vercelDeployArgs } from "./lib/release.mjs";
import { summarizePlaywrightReport } from "./lib/smoke-report.mjs";
import { gatedVercelConfig } from "./lib/vercel-config.mjs";
import { createVercelApi } from "./lib/vercel-api.mjs";
import { parseVercelDeployOutput } from "./lib/vercel-cli-output.mjs";

const targetName = process.argv
  .find((value) => value.startsWith("--target="))
  ?.slice("--target=".length);
const targets = loadTargets();
if (!validateReleaseSource(targets)) {
  console.error("Release source must be the reviewed repository main branch.");
  process.exit(1);
}
if (!Object.hasOwn(targets.targets, targetName ?? "")) {
  console.error("Usage: run.mjs --target=staging|production");
  process.exit(2);
}
const target = targets.targets[targetName];
const env = process.env;
if (!validateReleaseRuntime(env, targetName, targets.repository)) {
  console.error(
    "Release requires the trusted main quality workflow and matching environment.",
  );
  process.exit(1);
}
try {
  assertReleaseCheckout(env.GITHUB_SHA);
} catch {
  console.error("Release checkout must be clean and match the gated commit.");
  process.exit(1);
}
if (targetName === "staging") {
  try {
    validateOidcLifetime(await requestStagingOidc(env));
  } catch {
    console.error(
      "Staging OIDC acquisition failed; deployment was not started.",
    );
    process.exit(1);
  }
}
const outputDir = "release-output";
mkdirSync(outputDir, { recursive: true });

const committedVercelConfig = (() => {
  try {
    return JSON.parse(readFileSync("vercel.json", "utf8"));
  } catch {
    return null;
  }
})();

const api = createVercelApi({
  token: env.VERCEL_TOKEN,
  teamId: target.vercelTeamId,
});

async function currentMainSha() {
  const response = await fetch(GITHUB_MAIN_REF_URL, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`GitHub ref lookup failed (${response.status})`);
  const body = await response.json();
  if (!/^[0-9a-f]{40}$/.test(body?.object?.sha ?? "")) {
    throw new Error("GitHub main reference returned an invalid commit.");
  }
  return body?.object?.sha;
}

function deploy({ sha, runId }) {
  // The gated configuration is the one the cutover commits; writing it here
  // also keeps any ignored-build-step shortcut out of release builds.
  writeFileSync(
    "vercel.json",
    `${JSON.stringify(gatedVercelConfig(), null, 2)}\n`,
  );
  const result = spawnSync(
    "tools/release/node_modules/.bin/vercel",
    vercelDeployArgs({ sha, runId, skipDomain: target.skipDomain }),
    {
      encoding: "utf8",
      env: {
        PATH: env.PATH,
        HOME: env.HOME,
        CI: "1",
        VERCEL_TOKEN: env.VERCEL_TOKEN,
        VERCEL_ORG_ID: target.vercelTeamId,
        VERCEL_PROJECT_ID: target.vercelProjectId,
        VERCEL_TELEMETRY_DISABLED: "1",
      },
      // Upload and creation only: --no-wait returns once the build is queued.
      timeout: 10 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  // The pinned CLI may emit a bare URL or a JSON deployment/envelope. Keep
  // only its validated public deployment URL; suppress raw provider output.
  if (result.status !== 0) {
    throw new Error(`vercel deploy exited ${result.status ?? result.signal}`);
  }
  return parseVercelDeployOutput(result.stdout);
}

async function smoke({ phase, baseUrl, expectedSha, deploymentId }) {
  const config =
    phase === "staging"
      ? "playwright.staging.config.ts"
      : "playwright.production.config.ts";
  const reportFile = join(outputDir, `smoke-${phase}.json`);
  const execute = (oidcFile, signal) =>
    new Promise((resolve) => {
      const child = spawn(
        "pnpm",
        ["exec", "playwright", "test", "--config", config],
        {
          stdio: ["ignore", "inherit", "inherit"],
          env: {
            ...smokeEnvironment(env, targetName),
            ...(oidcFile ? { STAGING_VERCEL_OIDC_TOKEN_FILE: oidcFile } : {}),
            SMOKE_PHASE: phase,
            SMOKE_BASE_URL: baseUrl,
            SMOKE_EXPECTED_SHA: expectedSha,
            SMOKE_DEPLOYMENT_ID: deploymentId ?? "",
            SMOKE_TARGET: targetName,
            PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
          },
        },
      );
      let killTimer;
      const stop = () => {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      };
      const timeout = setTimeout(stop, 20 * 60_000);
      signal?.addEventListener("abort", stop, { once: true });
      const finish = (status) => {
        clearTimeout(timeout);
        clearTimeout(killTimer);
        signal?.removeEventListener("abort", stop);
        resolve({ status });
      };
      child.once("error", () => finish(null));
      child.once("close", finish);
      if (signal?.aborted) stop();
    });
  const result =
    targetName === "staging"
      ? await withStagingOidcFile(env, execute)
      : await execute();
  let report = null;
  try {
    report = JSON.parse(readFileSync(reportFile, "utf8"));
  } catch {
    return {
      ok: false,
      passed: 0,
      failed: 1,
      summary: `no ${phase} report (exit ${result.status})`,
    };
  }
  const summary = summarizePlaywrightReport(report);
  return { ...summary, ok: summary.ok && result.status === 0 };
}

const input = {
  targetName,
  target,
  repository: env.GITHUB_REPOSITORY,
  expectedRepository: targets.repository,
  ref: env.GITHUB_REF,
  sha: env.GITHUB_SHA,
  runId: env.GITHUB_RUN_ID,
  runUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
  committedVercelConfig,
  acknowledgedDeploymentIds: (env.RELEASE_ACKNOWLEDGED_DEPLOYMENTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};

const manifestPath = join(outputDir, "manifest.json");
const progressEvents = [];
const result = await runRelease(input, {
  api,
  deploy,
  smoke,
  backup: async () => {
    const validation = validateBackupWorkflowEnvironment(env);
    if (!validation.ok) return validation;
    const backup = await runConvexBackupGate({
      ...PRODUCTION_BACKUP_TARGET,
      adminKey: env.CONVEX_BACKUP_ADMIN_KEY,
      ambientEnv: env,
    });
    writeFileSync(
      join(outputDir, "backup-metadata.json"),
      `${JSON.stringify(backup, null, 2)}\n`,
    );
    return backup;
  },
  currentMainSha,
  clock: {
    now: () => Date.now(),
    monotonicNow: () => performance.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
  onEvent: (event, state) => {
    console.log(
      `[release:${targetName}] ${event.step}${event.deploymentId ? ` ${event.deploymentId}` : ""}`,
    );
    // Persist progress so a cancelled runner still leaves the deployment ID.
    progressEvents.push(event);
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          partial: true,
          target: targetName,
          sha: input.sha,
          runId: input.runId,
          mutation: state.mutation,
          phase: state.phase,
          vercel: {
            teamId: target.vercelTeamId,
            projectId: target.vercelProjectId,
            deploymentId: state.deploymentId,
            previousDeploymentId: state.previousDeploymentId,
            deploymentUrl: state.deploymentUrl,
          },
          events: progressEvents,
        },
        null,
        2,
      ),
    );
  },
});

const manifest = buildManifest(result, input);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
if (env.GITHUB_STEP_SUMMARY)
  appendFileSync(env.GITHUB_STEP_SUMMARY, summaryMarkdown(manifest));
if (env.GITHUB_OUTPUT) {
  appendFileSync(
    env.GITHUB_OUTPUT,
    `outcome=${manifest.outcome}\nmutation=${manifest.mutation}\ndeployment_id=${manifest.vercel.deploymentId ?? ""}\n`,
  );
}
console.log(summaryMarkdown(manifest));
process.exit(result.ok ? 0 : 1);
