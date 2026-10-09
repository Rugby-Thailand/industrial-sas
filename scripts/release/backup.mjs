#!/usr/bin/env node
// Trusted main-only native backup; called under the shared production lock.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import {
  backupFailure,
  PRODUCTION_BACKUP_TARGET,
  runConvexBackupGate,
  validateBackupWorkflowEnvironment,
} from "./lib/convex-backup.mjs";

const env = process.env;
const args = process.argv.slice(2);
const purpose =
  args.length === 0 ? "pre-release" : args[0]?.slice("--purpose=".length);
const validArgs =
  args.length === 0 ||
  (args.length === 1 && /^--purpose=(pre-release|daily)$/.test(args[0]));
let result = validArgs
  ? validateBackupWorkflowEnvironment(env)
  : backupFailure("INVALID_WORKFLOW");
try {
  if (result.ok) {
    result = await runConvexBackupGate({
      ...PRODUCTION_BACKUP_TARGET,
      adminKey: env.CONVEX_BACKUP_ADMIN_KEY,
      ambientEnv: env,
    });
  }
  const artifact = {
    schema: 1,
    purpose: validArgs ? purpose : "invalid",
    ok: result.ok,
    code: result.code,
    reason: result.reason,
    ...(result.ok
      ? {
          repository: PRODUCTION_BACKUP_TARGET.repository,
          sha: env.GITHUB_SHA,
          runId: env.GITHUB_RUN_ID,
          ...result.metadata,
        }
      : {}),
  };
  mkdirSync("release-output", { recursive: true });
  writeFileSync(
    "release-output/backup-metadata.json",
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  const summary = [
    "### Production backup",
    "",
    `**${result.ok ? "Passed" : "Failed"}:** ${result.code}. ${result.reason}`,
    ...(result.ok
      ? [
          "",
          `Deployment: ${PRODUCTION_BACKUP_TARGET.deploymentName}`,
          `Expiry (nanoseconds): ${result.metadata.expirationTs}`,
        ]
      : []),
    "",
  ].join("\n");
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  console.log(`[backup] ${result.code}: ${result.reason}`);
  process.exitCode = result.ok ? 0 : 1;
} catch {
  console.error(
    "[backup] BACKUP_INTERNAL_ERROR: Backup verification failed; internal details were suppressed.",
  );
  process.exitCode = 1;
}
