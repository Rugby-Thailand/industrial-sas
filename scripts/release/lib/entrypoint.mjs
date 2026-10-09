// Process boundaries for the trusted, main-only release runner.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This release controller is authorized for this repository's main branch only.
// Reviewed configuration may select deployment IDs, but cannot redirect the
// credential-bearing GitHub lookup to another repository or reference.
export const RELEASE_REPOSITORY = "Rugby-Thailand/industrial-sas";
export const GITHUB_MAIN_REF_URL =
  "https://api.github.com/repos/Rugby-Thailand/industrial-sas/git/ref/heads/main";

export function validateReleaseSource(targets) {
  return (
    targets?.repository === RELEASE_REPOSITORY &&
    targets?.releaseBranch === "main"
  );
}

export function validateReleaseRuntime(env, targetName, repository) {
  return (
    repository === RELEASE_REPOSITORY &&
    env.GITHUB_ACTIONS === "true" &&
    env.GITHUB_SERVER_URL === "https://github.com" &&
    env.GITHUB_REPOSITORY === repository &&
    env.GITHUB_REF === "refs/heads/main" &&
    ["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME) &&
    env.GITHUB_WORKFLOW_REF ===
      `${repository}/.github/workflows/quality.yml@refs/heads/main` &&
    env.RELEASE_ENVIRONMENT === targetName &&
    /^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? "") &&
    /^\d{1,20}$/.test(env.GITHUB_RUN_ID ?? "")
  );
}

export function assertReleaseCheckout(sha) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const changes = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" },
  );
  if (head !== sha || changes.trim()) {
    throw new Error(
      "Release checkout must be clean and match the gated commit.",
    );
  }
}

export function smokeEnvironment(env, targetName) {
  // Browser workers must not receive release, GitHub, or production backup keys.
  const result = { ...env };
  for (const key of [
    "VERCEL_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "CONVEX_BACKUP_ADMIN_KEY",
    "CONVEX_ADMIN_KEY",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
  ])
    delete result[key];
  if (targetName === "production") {
    delete result.CONVEX_DEPLOY_KEY;
  }
  return result;
}

export async function requestStagingOidc(env, fetchImpl = fetch) {
  if (
    !env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new Error(
      "Staging deployment protection requires job-scoped GitHub OIDC.",
    );
  }
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".actions.githubusercontent.com")
  ) {
    throw new Error(
      "OIDC request endpoint is not the GitHub Actions provider.",
    );
  }
  url.searchParams.set("audience", "https://github.com/Rugby-Thailand");
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Staging OIDC acquisition failed.");
  const body = await response.json();
  if (typeof body.value !== "string" || body.value.split(".").length !== 3) {
    throw new Error("Staging OIDC response was invalid.");
  }
  return body.value;
}

export function validateOidcLifetime(token, now = Date.now()) {
  let claims;
  try {
    claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
  } catch {
    throw new Error("Staging OIDC token is malformed.");
  }
  if (!Number.isSafeInteger(claims.exp) || claims.exp * 1000 < now + 90_000) {
    throw new Error("Staging OIDC token has insufficient remaining lifetime.");
  }
}

/** Parent owns OIDC authority; browser workers receive only a refreshable file. */
export async function withStagingOidcFile(
  env,
  operation,
  acquire = requestStagingOidc,
) {
  const directory = mkdtempSync(join(tmpdir(), "industrial-stage-oidc-"));
  const path = join(directory, "token");
  let interval;
  let failed = false;
  let refreshing = false;
  const controller = new AbortController();
  const refresh = async () => {
    if (refreshing || failed) return;
    refreshing = true;
    try {
      const token = await acquire(env);
      validateOidcLifetime(token);
      const next = join(directory, "next-token");
      writeFileSync(next, token, { mode: 0o600 });
      chmodSync(next, 0o600);
      renameSync(next, path);
    } catch {
      failed = true;
      controller.abort();
    } finally {
      refreshing = false;
    }
  };
  try {
    await refresh();
    if (failed) throw new Error("Staging OIDC refresh failed.");
    interval = setInterval(() => {
      void refresh();
    }, 45_000);
    const result = await operation(path, controller.signal);
    if (failed) throw new Error("Staging OIDC refresh failed.");
    return result;
  } finally {
    clearInterval(interval);
    // A request already in flight must not recreate the private file after cleanup.
    failed = true;
    controller.abort();
    while (refreshing) await new Promise((resolve) => setTimeout(resolve, 10));
    rmSync(directory, { recursive: true, force: true });
  }
}
