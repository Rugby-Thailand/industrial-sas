import { convexToJson } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import {
  MINIMUM_RECOVERY_WINDOW_MS,
  PRODUCTION_BACKUP_TARGET,
  runConvexBackupGate,
  validateBackupWorkflowEnvironment,
} from "../../scripts/release/lib/convex-backup.mjs";

const NOW = 1_791_563_692_503;
const KEY = "prod:greedy-cardinal-537|synthetic-private-credential";
const NS = 1_000_000n;
const input = { ...PRODUCTION_BACKUP_TARGET, adminKey: KEY };
const completed = () => ({
  state: "completed",
  requestor: "snapshotExport",
  format: { format: "zip", include_storage: true },
  start_ts: BigInt(NOW) * NS,
  complete_ts: BigInt(NOW + 10) * NS,
  expiration_ts: BigInt(NOW + MINIMUM_RECOVERY_WINDOW_MS + 10_000) * NS,
  size: 275_089n,
  zip_object_key: "synthetic-private-object-key",
});

function world(records: unknown[] = [null, completed()]) {
  let now = NOW + 10;
  let last: unknown = null;
  const query = vi.fn(async (_reference: unknown, _args: object) => {
    if (records.length) last = records.shift();
    return last;
  });
  const setAdminAuth = vi.fn();
  const setFetchOptions = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 200 }),
  );
  const factory = vi.fn((_url: string, _options: object) => ({
    query,
    setAdminAuth,
    setFetchOptions,
  }));
  const clock = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
  const deps = { fetch, clientFactory: factory, clock };
  return { deps, query, fetch, factory, setAdminAuth, setFetchOptions };
}

describe("native production backup gate", () => {
  it("requests exactly a storage ZIP and emits only public metadata", async () => {
    const w = world([
      null,
      { state: "requested" },
      { state: "in_progress" },
      completed(),
    ]);
    const result = await runConvexBackupGate(input, w.deps);
    expect(result.ok).toBe(true);
    expect(w.fetch).toHaveBeenCalledOnce();
    const [url, options] = w.fetch.mock.calls[0]!;
    expect(url).toBe(
      `${PRODUCTION_BACKUP_TARGET.deploymentUrl}/api/export/request/zip?includeStorage=true`,
    );
    expect(options).toMatchObject({
      method: "POST",
      headers: { Authorization: `Convex ${KEY}` },
      redirect: "error",
    });
    expect(options).not.toHaveProperty("body");
    expect(w.setAdminAuth).toHaveBeenCalledWith(KEY);
    expect(w.factory.mock.calls[0]?.[1]).toMatchObject({ logger: false });
    expect(w.query.mock.calls.every((call) => call.length === 2)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(
      "synthetic-private-object-key",
    );
    expect(JSON.stringify(result)).not.toContain("zip_object_key");
  });

  it.each([
    { adminKey: "dev:greedy-cardinal-537|synthetic" },
    { adminKey: "prod:other-deployment|synthetic" },
    { adminKey: "preview:trustera:industrial-sas|synthetic" },
    { adminKey: "" },
    { deploymentName: "precise-rabbit-956" },
    { deploymentUrl: "https://greedy-cardinal-537.convex.cloud.evil.invalid" },
    { deploymentUrl: "http://greedy-cardinal-537.convex.cloud" },
    { ambientEnv: { CONVEX_DEPLOYMENT: "prod:greedy-cardinal-537" } },
    { ambientEnv: { CONVEX_DEPLOY_KEY: KEY } },
    { ambientEnv: { CONVEX_ADMIN_KEY: KEY } },
    { ambientEnv: { NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210" } },
  ])(
    "rejects wrong or ambient selection before network: %j",
    async (override) => {
      const w = world();
      const result = await runConvexBackupGate(
        { ...input, ...override },
        w.deps,
      );
      expect(result).toMatchObject({ ok: false, code: "INVALID_TARGET" });
      expect(w.fetch).not.toHaveBeenCalled();
      expect(w.factory).not.toHaveBeenCalled();
    },
  );

  it("rejects an omitted backup key before constructing a client", async () => {
    const w = world();
    expect(
      await runConvexBackupGate(PRODUCTION_BACKUP_TARGET, w.deps),
    ).toMatchObject({
      ok: false,
      code: "INVALID_TARGET",
    });
    expect(w.factory).not.toHaveBeenCalled();
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it.each(["requested", "in_progress"])(
    "does not coalesce with a pre-existing %s export",
    async (state) => {
      const w = world([{ state }]);
      expect(await runConvexBackupGate(input, w.deps)).toMatchObject({
        ok: false,
        code: "BACKUP_ALREADY_RUNNING",
      });
      expect(w.fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects the prior completed snapshot even inside allowed clock skew", async () => {
    const record = completed();
    const w = world([record, record]);
    expect(await runConvexBackupGate(input, w.deps)).toMatchObject({
      ok: false,
      code: "INVALID_METADATA",
    });
  });

  it.each([
    { start_ts: BigInt(NOW - 60_000) * NS },
    { complete_ts: BigInt(NOW - 60_000) * NS },
    { complete_ts: BigInt(NOW + 60_000) * NS },
    { expiration_ts: BigInt(NOW - 1) * NS },
    { expiration_ts: BigInt(NOW + MINIMUM_RECOVERY_WINDOW_MS - 1) * NS },
    { requestor: "cloudBackup" },
    { format: { format: "zip", include_storage: false } },
    { format: { format: "zip" } },
    { format: { format: "json", include_storage: true } },
    { start_ts: Number(BigInt(NOW) * NS) },
    { complete_ts: String(BigInt(NOW) * NS) },
    { expiration_ts: undefined },
    { size: -1n },
  ])(
    "fails closed on insufficient/malformed completed evidence %#",
    async (override) => {
      const w = world([null, { ...completed(), ...override }]);
      expect(await runConvexBackupGate(input, w.deps)).toMatchObject({
        ok: false,
        code: "INVALID_METADATA",
      });
    },
  );

  it.each([undefined, "not metadata", { state: "unknown" }, {}])(
    "rejects malformed baseline metadata %#",
    async (baseline) => {
      const w = world([baseline]);
      expect(await runConvexBackupGate(input, w.deps)).toMatchObject({
        ok: false,
        code: "INVALID_METADATA",
      });
      expect(w.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["failed", "canceled"])("refuses a %s snapshot", async (state) => {
    const w = world([null, { state }]);
    expect(await runConvexBackupGate(input, w.deps)).toMatchObject({
      ok: false,
      code: "BACKUP_FAILED",
    });
  });

  it("bounds polling when completion never arrives", async () => {
    const w = world([null, { state: "in_progress" }]);
    const result = await runConvexBackupGate(
      { ...input, limits: { timeoutMs: 5_000, pollIntervalMs: 1_000 } },
      w.deps,
    );
    expect(result).toMatchObject({ ok: false, code: "BACKUP_TIMEOUT" });
    expect(w.query.mock.calls.length).toBeLessThanOrEqual(7);
  });

  it("bounds a hung request even when its fetch ignores abort", async () => {
    const w = world();
    w.fetch.mockImplementation(async () => new Promise<Response>(() => {}));
    const result = await runConvexBackupGate(
      { ...input, limits: { operationTimeoutMs: 15 } },
      w.deps,
    );
    expect(result).toMatchObject({ ok: false, code: "BACKUP_TIMEOUT" });
    expect(w.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("does not accept completion arriving beyond the total deadline", async () => {
    const w = world();
    let now = NOW + 10;
    let reads = 0;
    w.query.mockImplementation(async () => {
      if (reads++ === 0) return null;
      now += 1_001;
      return completed();
    });
    expect(
      await runConvexBackupGate(
        { ...input, limits: { timeoutMs: 1_000 } },
        {
          ...w.deps,
          clock: { now: () => now, sleep: async () => {} },
        },
      ),
    ).toMatchObject({ ok: false, code: "BACKUP_TIMEOUT" });
  });

  it("bounds a hung metadata query", async () => {
    const w = world();
    w.query.mockImplementation(async () => new Promise(() => {}));
    expect(
      await runConvexBackupGate(
        { ...input, limits: { operationTimeoutMs: 15 } },
        w.deps,
      ),
    ).toMatchObject({ ok: false, code: "BACKUP_TIMEOUT" });
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it("never reads or publishes failed request bodies", async () => {
    const w = world();
    const response = new Response(`provider echoed ${KEY}`, { status: 403 });
    const readBody = vi.spyOn(response, "text");
    w.fetch.mockResolvedValue(response);
    const result = await runConvexBackupGate(input, w.deps);
    expect(result).toMatchObject({ ok: false, code: "BACKUP_REQUEST_FAILED" });
    expect(readBody).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it.each(["request", "query"])("redacts thrown %s errors", async (phase) => {
    const w = world();
    if (phase === "request")
      w.fetch.mockRejectedValue(new Error(`provider echoed ${KEY}`));
    else w.query.mockRejectedValue(new Error(`SDK echoed ${KEY}`));
    const result = await runConvexBackupGate(input, w.deps);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain("echoed");
  });

  it("uses the real pinned SDK with fake HTTP responses and suppresses its log lines", async () => {
    let reads = 0;
    const log = vi.spyOn(console, "log");
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, options) => {
      if (String(url).includes("/api/export/request/zip"))
        return new Response(null, { status: 200 });
      expect(String(url)).toBe(
        `${PRODUCTION_BACKUP_TARGET.deploymentUrl}/api/query`,
      );
      expect(options?.redirect).toBe("error");
      expect(options?.headers).toMatchObject({
        Authorization: `Convex ${KEY}`,
      });
      expect(JSON.parse(String(options?.body))).toMatchObject({
        path: "_system/cli/exports:getLatest",
        args: [{}],
      });
      return Response.json({
        status: "success",
        value: reads++ === 0 ? null : convexToJson(completed()),
        logLines: [`provider echoed ${KEY}`],
      });
    });
    try {
      expect(
        await runConvexBackupGate(input, {
          fetch,
          clock: { now: () => NOW + 10, sleep: async () => {} },
        }),
      ).toMatchObject({ ok: true });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("masks sensitive HTTP error bodies raised by the real SDK", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(`provider echoed ${KEY}`, { status: 403 }),
    );
    const result = await runConvexBackupGate(input, {
      fetch,
      clock: { now: () => NOW + 10, sleep: async () => {} },
    });
    expect(result).toMatchObject({ ok: false, code: "BACKUP_QUERY_FAILED" });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain("echoed");
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("trusted backup CLI environment", () => {
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: PRODUCTION_BACKUP_TARGET.repository,
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "push",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ID: "123",
    RELEASE_ENVIRONMENT: "production",
    CONVEX_BACKUP_ADMIN_KEY: KEY,
  };
  it("accepts the declared protected main environment", () => {
    expect(validateBackupWorkflowEnvironment(env)).toEqual({ ok: true });
  });
  it.each([
    { GITHUB_ACTIONS: undefined },
    { GITHUB_SERVER_URL: "https://evil.invalid" },
    { GITHUB_REPOSITORY: "fork/industrial-sas" },
    { GITHUB_REF: "refs/pull/1/merge" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_EVENT_NAME: undefined },
    { GITHUB_SHA: "invalid" },
    { GITHUB_RUN_ID: "invalid" },
    { RELEASE_ENVIRONMENT: "staging" },
    { CONVEX_BACKUP_ADMIN_KEY: undefined },
  ])("refuses untrusted, missing, or wrong identity %#", (override) => {
    const result = validateBackupWorkflowEnvironment({ ...env, ...override });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});
