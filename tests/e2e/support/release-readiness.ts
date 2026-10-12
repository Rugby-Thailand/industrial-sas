import type { APIRequestContext } from "@playwright/test";
import type { APIResponse } from "@playwright/test";

const SHA = /^[0-9a-f]{40}$/;

/**
 * A control-plane promotion can precede the public domain's switch. Poll only
 * a successful response carrying a valid older commit, before checking the
 * runtime contract. Never rebuild, restart the suite or retry a runtime fault.
 */
export async function waitForReleasedResponse(
  request: APIRequestContext,
  path: "/th/sign-in" | "/api/runtime",
  expectedSha: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 1_000;
  if (
    !SHA.test(expectedSha) ||
    !["/th/sign-in", "/api/runtime"].includes(path) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 30_000 ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0 ||
    intervalMs > timeoutMs
  ) {
    throw new Error("SMOKE_RELEASE_READINESS_INPUT_INVALID");
  }
  const deadline = performance.now() + timeoutMs;
  let sawDifferentCommit = false;
  for (;;) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error("SMOKE_RELEASE_SHA_MISMATCH");
    let response: APIResponse;
    try {
      response = await request.get(path, {
        timeout: Math.min(5_000, remaining),
        maxRedirects: 0,
        maxRetries: 0,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        [
          "STAGING_PROTECTION_TOKEN_UNAVAILABLE",
          "STAGING_PROTECTION_ORIGIN_INVALID",
        ].includes(error.message)
      )
        throw error;
      throw new Error(
        sawDifferentCommit && performance.now() >= deadline
          ? "SMOKE_RELEASE_SHA_MISMATCH"
          : "SMOKE_RELEASE_REQUEST_FAILED",
      );
    }
    if (response.status() !== 200) {
      await response.dispose();
      throw new Error("SMOKE_RELEASE_HTTP_STATUS_INVALID");
    }
    const observedSha = response.headers()["x-release-sha"];
    if (!observedSha || !SHA.test(observedSha)) {
      await response.dispose();
      throw new Error("SMOKE_RELEASE_SHA_MISSING_OR_INVALID");
    }
    if (observedSha === expectedSha) return response;
    sawDifferentCommit = true;
    await response.dispose();
    const delay = Math.min(intervalMs, deadline - performance.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/** Fixed failure codes survive the sensitive reporter without response data. */
export async function verifyBunRuntime(
  response: APIResponse,
  expectedSha: string,
) {
  if (!response.headers()["cache-control"]?.includes("no-store"))
    throw new Error("SMOKE_RUNTIME_CACHE_INVALID");
  let status: unknown;
  try {
    status = await response.json();
  } catch {
    throw new Error("SMOKE_RUNTIME_RESPONSE_INVALID");
  }
  if (!status || typeof status !== "object")
    throw new Error("SMOKE_RUNTIME_RESPONSE_INVALID");
  if (!("runtime" in status) || status.runtime !== "bun")
    throw new Error("SMOKE_RUNTIME_NOT_BUN");
  if (
    !("version" in status) ||
    typeof status.version !== "string" ||
    !/^1\.4\.\d+$/.test(status.version)
  )
    throw new Error("SMOKE_RUNTIME_VERSION_INVALID");
  // Vercel may omit the build-time variable from its serving process. The
  // response header already binds the build; a non-null body SHA must agree.
  if (
    !("releaseSha" in status) ||
    (status.releaseSha !== null && status.releaseSha !== expectedSha)
  )
    throw new Error("SMOKE_RUNTIME_SHA_INVALID");
}
