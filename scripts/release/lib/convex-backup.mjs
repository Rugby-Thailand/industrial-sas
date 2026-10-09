// Metadata-only production snapshot gate. The key needs only backup create/view.
// No Convex CLI, saved account login, download, import, or delete is used.
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export const PRODUCTION_BACKUP_TARGET = Object.freeze({
  repository: "Rugby-Thailand/industrial-sas",
  deploymentName: "greedy-cardinal-537",
  deploymentUrl: "https://greedy-cardinal-537.convex.cloud",
});
export const MINIMUM_RECOVERY_WINDOW_MS = 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 5_000;
const NS_PER_MS = 1_000_000n;
const LATEST_EXPORT = makeFunctionReference("_system/cli/exports:getLatest");
const AMBIENT_SELECTION = [
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_ADMIN_KEY",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
];
const REASONS = Object.freeze({
  INVALID_TARGET:
    "Backup target or credential selection is not the reviewed production deployment.",
  INVALID_WORKFLOW:
    "Backup requires the trusted repository, main ref, production environment, and valid run identity.",
  INVALID_LIMITS: "Backup time limits are invalid.",
  BACKUP_ALREADY_RUNNING:
    "An earlier native export is still running; no new snapshot was requested.",
  BACKUP_REQUEST_FAILED:
    "Native snapshot request failed; provider details were suppressed.",
  BACKUP_QUERY_FAILED:
    "Snapshot metadata query failed; provider details were suppressed.",
  BACKUP_TIMEOUT:
    "Snapshot request or completion exceeded the backup deadline.",
  BACKUP_FAILED: "The native snapshot ended without completing.",
  INVALID_METADATA:
    "Snapshot metadata does not prove a fresh complete export with storage and a 24-hour recovery window.",
  BACKUP_COMPLETED:
    "A new production snapshot including Convex storage completed with a verified recovery window.",
  BACKUP_INTERNAL_ERROR:
    "Backup verification failed; internal details were suppressed.",
});

export function backupFailure(code) {
  const safeCode = Object.hasOwn(REASONS, code)
    ? code
    : "BACKUP_INTERNAL_ERROR";
  return { ok: false, code: safeCode, reason: REASONS[safeCode] };
}

const present = (env, name) =>
  typeof env[name] === "string" && env[name].trim() !== "";

/** Validate before constructing a client or sending any request. */
export function validateBackupTarget(input) {
  const target = PRODUCTION_BACKUP_TARGET;
  if (
    input.deploymentName !== target.deploymentName ||
    input.deploymentUrl !== target.deploymentUrl ||
    typeof input.adminKey !== "string" ||
    !new RegExp(`^prod:${target.deploymentName}\\|[^\\s|]+$`).test(
      input.adminKey,
    )
  )
    return backupFailure("INVALID_TARGET");
  const ambient = input.ambientEnv ?? {};
  if (AMBIENT_SELECTION.some((name) => present(ambient, name)))
    return backupFailure("INVALID_TARGET");
  for (const name of ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL"]) {
    if (present(ambient, name) && ambient[name] !== target.deploymentUrl)
      return backupFailure("INVALID_TARGET");
  }
  return { ok: true };
}

/** The CLI has no local/operator mode and cannot silently select ambient auth. */
export function validateBackupWorkflowEnvironment(env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_SERVER_URL !== "https://github.com" ||
    env.GITHUB_REPOSITORY !== PRODUCTION_BACKUP_TARGET.repository ||
    env.GITHUB_REF !== "refs/heads/main" ||
    !["push", "workflow_dispatch", "schedule", "workflow_run"].includes(
      env.GITHUB_EVENT_NAME,
    ) ||
    env.RELEASE_ENVIRONMENT !== "production" ||
    !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? "") ||
    !/^\d{1,20}$/.test(env.GITHUB_RUN_ID ?? "")
  )
    return backupFailure("INVALID_WORKFLOW");
  return validateBackupTarget({
    ...PRODUCTION_BACKUP_TARGET,
    adminKey: env.CONVEX_BACKUP_ADMIN_KEY,
    ambientEnv: env,
  });
}

class OperationTimeout extends Error {}

async function bounded(operation, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new OperationTimeout());
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const defaultClock = {
  now: () => Date.now(),
  monotonicNow: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * @param {{adminKey?: string, deploymentName?: string, deploymentUrl?: string,
 *   ambientEnv?: Record<string, string|undefined>, limits?: {
 *   timeoutMs?: number, operationTimeoutMs?: number, pollIntervalMs?: number}}} input
 * @param {{fetch?: typeof globalThis.fetch, clock?: {
 *   now: () => number, monotonicNow?: () => number, sleep: (ms: number) => Promise<void>},
 *   clientFactory?: (url: string, options: object) => {
 *   setAdminAuth: (key: string) => void,
 *   setFetchOptions: (options: object) => void,
 *   query: (reference: unknown, args: object) => Promise<unknown>}}} deps
 */
export async function runConvexBackupGate(input, deps = {}) {
  const validation = validateBackupTarget(input);
  if (!validation.ok) return validation;
  const limits = {
    timeoutMs: 15 * 60_000,
    operationTimeoutMs: 30_000,
    pollIntervalMs: 2_000,
    ...input.limits,
  };
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    limits.timeoutMs > 30 * 60_000 ||
    limits.operationTimeoutMs > 30_000 ||
    limits.pollIntervalMs > 30_000
  )
    return backupFailure("INVALID_LIMITS");

  const clock = deps.clock ?? defaultClock;
  const monotonicNow = clock.monotonicNow ?? clock.now;
  const deadline = monotonicNow() + limits.timeoutMs;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const remaining = () =>
    Math.min(limits.operationTimeoutMs, Math.max(0, deadline - monotonicNow()));
  try {
    // Every SDK request stays on the reviewed origin; redirects cannot carry auth.
    const protectedFetch = (url, options) => {
      const parsed = new URL(
        typeof url === "string" ? url : (url.url ?? String(url)),
      );
      if (
        parsed.origin !== input.deploymentUrl ||
        parsed.pathname !== "/api/query" ||
        options?.method !== "POST"
      ) {
        throw new Error("Unreviewed snapshot metadata endpoint");
      }
      return fetchImpl(url, { ...options, redirect: "error" });
    };
    const client = deps.clientFactory
      ? deps.clientFactory(input.deploymentUrl, {
          logger: false,
          fetch: protectedFetch,
        })
      : new ConvexHttpClient(input.deploymentUrl, {
          logger: false,
          fetch: protectedFetch,
        });
    client.setAdminAuth(input.adminKey);
    const latest = async () => {
      const timeout = remaining();
      if (timeout <= 0) throw new OperationTimeout();
      return bounded((signal) => {
        client.setFetchOptions({ signal, redirect: "error" });
        return client.query(LATEST_EXPORT, {});
      }, timeout);
    };

    let before;
    try {
      before = await latest();
    } catch (error) {
      return backupFailure(
        error instanceof OperationTimeout
          ? "BACKUP_TIMEOUT"
          : "BACKUP_QUERY_FAILED",
      );
    }
    if (before?.state === "requested" || before?.state === "in_progress")
      return backupFailure("BACKUP_ALREADY_RUNNING");
    if (
      before !== null &&
      (typeof before !== "object" ||
        !["completed", "failed", "canceled"].includes(before.state))
    ) {
      return backupFailure("INVALID_METADATA");
    }
    const previousStart =
      before?.state === "completed" ? before.start_ts : null;
    if (previousStart !== null && typeof previousStart !== "bigint")
      return backupFailure("INVALID_METADATA");
    const requestedAtMs = clock.now();
    if (!Number.isSafeInteger(requestedAtMs) || requestedAtMs < 0)
      return backupFailure("INVALID_METADATA");
    try {
      const timeout = remaining();
      if (timeout <= 0) throw new OperationTimeout();
      const response = await bounded(
        (signal) =>
          fetchImpl(
            `${input.deploymentUrl}/api/export/request/zip?includeStorage=true`,
            {
              method: "POST",
              headers: { Authorization: `Convex ${input.adminKey}` },
              signal,
              redirect: "error",
            },
          ),
        timeout,
      );
      // The request body and response body are intentionally never read/logged.
      if (!response.ok) return backupFailure("BACKUP_REQUEST_FAILED");
    } catch (error) {
      return backupFailure(
        error instanceof OperationTimeout
          ? "BACKUP_TIMEOUT"
          : "BACKUP_REQUEST_FAILED",
      );
    }

    for (;;) {
      let record;
      try {
        record = await latest();
      } catch (error) {
        return backupFailure(
          error instanceof OperationTimeout
            ? "BACKUP_TIMEOUT"
            : "BACKUP_QUERY_FAILED",
        );
      }
      if (monotonicNow() >= deadline) return backupFailure("BACKUP_TIMEOUT");
      if (record?.state === "failed" || record?.state === "canceled")
        return backupFailure("BACKUP_FAILED");
      if (record?.state === "completed") {
        const verifiedAtMs = clock.now();
        if (!Number.isSafeInteger(verifiedAtMs) || verifiedAtMs < 0)
          return backupFailure("INVALID_METADATA");
        const freshAfter = BigInt(requestedAtMs - CLOCK_SKEW_MS) * NS_PER_MS;
        const nowNs = BigInt(verifiedAtMs) * NS_PER_MS;
        if (
          record.requestor !== "snapshotExport" ||
          record.format?.format !== "zip" ||
          record.format?.include_storage !== true ||
          typeof record.start_ts !== "bigint" ||
          typeof record.complete_ts !== "bigint" ||
          typeof record.expiration_ts !== "bigint" ||
          record.start_ts < freshAfter ||
          record.complete_ts < freshAfter ||
          record.complete_ts < record.start_ts ||
          record.complete_ts > nowNs + BigInt(CLOCK_SKEW_MS) * NS_PER_MS ||
          record.expiration_ts <
            nowNs + BigInt(MINIMUM_RECOVERY_WINDOW_MS) * NS_PER_MS ||
          (previousStart !== null && record.start_ts <= previousStart) ||
          (record.size !== undefined &&
            (typeof record.size !== "bigint" || record.size < 0n))
        )
          return backupFailure("INVALID_METADATA");
        // Construct from an allowlist. Never copy _id, zip_object_key, URLs, logs,
        // or any other provider response field into a public artifact.
        return {
          ok: true,
          code: "BACKUP_COMPLETED",
          reason: REASONS.BACKUP_COMPLETED,
          metadata: {
            schema: 1,
            deploymentName: input.deploymentName,
            requestor: "snapshotExport",
            state: "completed",
            includeStorage: true,
            requestedAtMs,
            verifiedAtMs,
            startTs: record.start_ts.toString(),
            completeTs: record.complete_ts.toString(),
            expirationTs: record.expiration_ts.toString(),
            ...(record.size === undefined
              ? {}
              : { sizeBytes: record.size.toString() }),
          },
        };
      }
      if (
        record !== null &&
        (typeof record !== "object" ||
          !["requested", "in_progress"].includes(record.state))
      ) {
        return backupFailure("INVALID_METADATA");
      }
      const wait = Math.min(limits.pollIntervalMs, deadline - monotonicNow());
      if (wait <= 0) return backupFailure("BACKUP_TIMEOUT");
      await bounded(() => clock.sleep(wait), wait + 100);
    }
  } catch (error) {
    return backupFailure(
      error instanceof OperationTimeout
        ? "BACKUP_TIMEOUT"
        : "BACKUP_INTERNAL_ERROR",
    );
  }
}
