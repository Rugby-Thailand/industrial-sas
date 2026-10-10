import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { TestCase, TestResult } from "@playwright/test/reporter";
import { afterEach, describe, expect, it, vi } from "vitest";

import { summarizePlaywrightReport } from "../../scripts/release/lib/smoke-report.mjs";
import {
  OIDC_HEADER,
  protectedRequest,
  readStagingToken,
  stagingProtection,
  withoutProtectionHeaders,
} from "../e2e/support/protected-origin";
import {
  clientScriptUrls,
  clientIdentityConfiguration,
  isOwnedIdentityHost,
  releaseSmokeInputs,
} from "../e2e/support/release-env";
import SensitiveReporter from "../e2e/support/sensitive-reporter";
import { runPolicy } from "../e2e/support/policy";

const roots: string[] = [];
const STAGE = "https://industrial-sas-staging.vercel.app";
const OTHER = "https://other.invalid";
const SENTINEL = "nonfunctional-sensitive-sentinel";

function unsignedToken(
  exp = Math.floor(Date.now() / 1_000) + 300,
  label = "test",
) {
  return `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ exp, label })).toString("base64url")}.nonfunctional`;
}

function temp() {
  const root = mkdtempSync(join(tmpdir(), "browser-safety-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fakeRequest(responses: { status: number; location?: string }[]) {
  const fetch = vi.fn(async (_url: string, _options: unknown) => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected request; no network is allowed.");
    return {
      status: () => next.status,
      headers: () => (next.location ? { location: next.location } : {}),
      dispose: vi.fn(async () => {}),
    } as unknown as APIResponse;
  });
  return { request: { fetch } as unknown as APIRequestContext, fetch };
}

describe("protected stage origin", () => {
  it.each([
    "https://app.thaipropertyai.com",
    "http://industrial-sas-staging.vercel.app",
    "https://industrial-sas-staging.vercel.app:444",
    "https://industrial-sas-staging.vercel.app.other.invalid",
    "https://user@industrial-sas-staging.vercel.app",
  ])("rejects the unreviewed origin %s before reading a token", (base) => {
    expect(() =>
      stagingProtection({
        SMOKE_TARGET: "staging",
        SMOKE_BASE_URL: base,
        STAGING_VERCEL_OIDC_TOKEN_FILE: "/nonexistent-private-file",
      }),
    ).toThrow("STAGING_PROTECTION_ORIGIN_INVALID");
  });

  it("never reads or attaches a stage token for production", async () => {
    const protection = stagingProtection({
      SMOKE_TARGET: "production",
      STAGING_VERCEL_OIDC_TOKEN_FILE: "/missing",
    });
    expect(protection).toBeUndefined();
    const fake = fakeRequest([{ status: 200 }]);
    await protectedRequest(fake.request, `${OTHER}/`, protection, {
      headers: {
        [OIDC_HEADER]: SENTINEL,
        "X-Vercel-Protection-Bypass": SENTINEL,
      },
    });
    expect(fake.fetch.mock.calls[0]?.[1]).toMatchObject({ headers: {} });
  });

  it("rereads the private file and never falls back when a configured file fails", () => {
    const file = join(temp(), "oidc");
    const env = {
      STAGING_VERCEL_OIDC_TOKEN_FILE: file,
      STAGING_VERCEL_OIDC_TOKEN: unsignedToken(),
    };
    const first = unsignedToken(undefined, "first");
    const rotated = unsignedToken(undefined, "rotated");
    writeFileSync(file, first, { mode: 0o600 });
    expect(readStagingToken(env)).toBe(first);
    writeFileSync(file, rotated);
    expect(readStagingToken(env)).toBe(rotated);
    rmSync(file);
    expect(() => readStagingToken(env)).toThrow(
      "STAGING_PROTECTION_TOKEN_UNAVAILABLE",
    );
    expect(readStagingToken({ STAGING_VERCEL_OIDC_TOKEN: rotated })).toBe(
      rotated,
    );
  });

  it("fails closed for malformed, expired and nearly expired local tokens", () => {
    for (const token of [
      "opaque-token",
      "bad.not-json.signature",
      unsignedToken(Math.floor(Date.now() / 1_000) - 1),
      unsignedToken(Math.floor(Date.now() / 1_000) + 30),
      `header.${Buffer.from('{"exp":"9999999999"}').toString("base64url")}.signature`,
    ])
      expect(() =>
        readStagingToken({ STAGING_VERCEL_OIDC_TOKEN: token }),
      ).toThrow("STAGING_PROTECTION_TOKEN_UNAVAILABLE");
  });

  it("uses a fresh token on same-origin redirects and strips it on other origins", async () => {
    const fake = fakeRequest([
      { status: 302, location: "/second" },
      { status: 302, location: `${OTHER}/third` },
      { status: 302, location: "/final" },
      { status: 200 },
    ]);
    const readToken = vi
      .fn()
      .mockReturnValueOnce("first-token")
      .mockReturnValueOnce("rotated-token");
    await protectedRequest(
      fake.request,
      `${STAGE}/first`,
      { origin: STAGE, readToken },
      {
        headers: {
          Authorization: SENTINEL,
          [OIDC_HEADER]: "untrusted-override",
        },
      },
    );
    const options = fake.fetch.mock.calls.map((call) => call[1]);
    expect(options[0]).toMatchObject({
      headers: { [OIDC_HEADER]: "first-token" },
      maxRedirects: 0,
      maxRetries: 0,
    });
    expect(options[1]).toMatchObject({
      headers: { [OIDC_HEADER]: "rotated-token" },
    });
    expect(options[2]).toMatchObject({ headers: {} });
    expect(options[3]).toMatchObject({ headers: {} });
    expect(readToken).toHaveBeenCalledTimes(2);
  });

  it("honors no-follow probes, bounds redirect loops, and refuses write redirects", async () => {
    const noFollow = fakeRequest([{ status: 307, location: `${OTHER}/` }]);
    expect(
      (
        await protectedRequest(noFollow.request, `${STAGE}/`, undefined, {
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(307);
    expect(noFollow.fetch).toHaveBeenCalledTimes(1);
    const loop = fakeRequest([
      { status: 302, location: "/again" },
      { status: 302, location: "/again" },
    ]);
    await expect(
      protectedRequest(loop.request, `${STAGE}/`, undefined, {
        maxRedirects: 1,
      }),
    ).rejects.toThrow("SMOKE_REDIRECT_LIMIT_EXCEEDED");
    const write = fakeRequest([{ status: 307, location: `${OTHER}/` }]);
    await expect(
      protectedRequest(write.request, `${STAGE}/`, undefined, {
        method: "POST",
        data: SENTINEL,
      }),
    ).rejects.toThrow("SMOKE_WRITE_REDIRECT_REFUSED");
    expect(write.fetch).toHaveBeenCalledTimes(1);
    expect(
      withoutProtectionHeaders({
        "X-Vercel-Trusted-Oidc-Idp-Token": SENTINEL,
        Accept: "text/html",
      }),
    ).toEqual({ Accept: "text/html" });
  });
});

describe("release smoke inputs and assets", () => {
  const identityTarget = {
    clerkKeyClass: "test" as const,
    clerkFrontendHost: "stage.clerk.fixture.invalid",
  };
  const identityKey = (
    keyClass = "test",
    host = identityTarget.clerkFrontendHost,
  ) => `pk_${keyClass}_${Buffer.from(`${host}$`).toString("base64")}`;

  it.each([true, false])(
    "accepts the reviewed identity key independent of Base64 padding (%s)",
    (padded) => {
      const key = identityKey();
      expect(key.endsWith("=")).toBe(true);
      expect(
        clientIdentityConfiguration(
          `<script>const identity=${JSON.stringify(padded ? key : key.replace(/=+$/, ""))}</script>`,
          identityTarget,
        ),
      ).toEqual({ hasExpectedIdentityKey: true, hasForeignIdentityKey: false });
    },
  );

  it.each([
    identityKey("live"),
    identityKey("test", "other.clerk.fixture.invalid"),
  ])(
    "rejects a foreign identity class or host alongside the reviewed key",
    (foreign) => {
      expect(
        clientIdentityConfiguration(
          `${identityKey()} ${foreign}`,
          identityTarget,
        ),
      ).toEqual({ hasExpectedIdentityKey: true, hasForeignIdentityKey: true });
    },
  );

  it.each(["<html>No identity key</html>", "pk_test_not-a-valid-key"])(
    "does not accept absent or malformed identity configuration",
    (bundle) => {
      expect(clientIdentityConfiguration(bundle, identityTarget)).toEqual({
        hasExpectedIdentityKey: false,
        hasForeignIdentityKey: false,
      });
    },
  );

  it("requires the reviewed candidate origin and cannot be opened by an environment allowlist", () => {
    vi.stubEnv("SMOKE_TARGET", "production");
    vi.stubEnv("SMOKE_PHASE", "candidate");
    vi.stubEnv("SMOKE_EXPECTED_SHA", "c".repeat(40));
    vi.stubEnv("SMOKE_BASE_URL", "https://unreviewed.vercel.app");
    vi.stubEnv("SMOKE_OWNED_HOSTS", "unreviewed.vercel.app");
    expect(() => releaseSmokeInputs()).toThrow("reviewed release target");
    vi.stubEnv("SMOKE_BASE_URL", "https://ci-candidate.thaipropertyai.com");
    expect(releaseSmokeInputs().baseUrl).toBe(
      "https://ci-candidate.thaipropertyai.com",
    );
    expect(
      isOwnedIdentityHost(
        "http://ci-candidate.thaipropertyai.com",
        "https://app.thaipropertyai.com",
      ),
    ).toBe(false);
    vi.stubEnv("SMOKE_PHASE", "live");
    expect(() => releaseSmokeInputs()).toThrow("reviewed release target");
  });

  it("preserves Next deployment queries while restricting and bounding static chunks", () => {
    expect(
      clientScriptUrls(
        `<script src="/_next/static/a.js?dpl=reviewed&amp;x=1"></script><script src='${STAGE}/_next/static/b.js'></script><script src="${OTHER}/_next/static/evil.js"></script>`,
        STAGE,
      ),
    ).toEqual([
      `${STAGE}/_next/static/a.js?dpl=reviewed&x=1`,
      `${STAGE}/_next/static/b.js`,
    ]);
    expect(() => clientScriptUrls("<html>No scripts</html>", STAGE)).toThrow(
      "SMOKE_CLIENT_CHUNK_INVENTORY_INVALID",
    );
    expect(() =>
      clientScriptUrls(
        Array.from(
          { length: 61 },
          (_, n) => `<script src="/_next/static/${n}.js"></script>`,
        ).join(""),
        STAGE,
      ),
    ).toThrow("SMOKE_CLIENT_CHUNK_INVENTORY_INVALID");
  });
});

function testCase(
  id: string,
  outcome: string,
  expectedStatus = "passed",
  optional = false,
): TestCase {
  return {
    id,
    title: SENTINEL,
    expectedStatus,
    outcome: () => outcome,
    annotations: optional
      ? [{ type: "not-configured", description: SENTINEL }]
      : [],
  } as unknown as TestCase;
}

describe("sensitive reporting", () => {
  it("retains controller statuses while excluding raw credentials, errors, streams and attachments", () => {
    const root = temp();
    const outputFile = join(root, "safe.json");
    const junitFile = join(root, "safe.xml");
    const reporter = new SensitiveReporter({ outputFile, junitFile });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    reporter.onStdOut(SENTINEL);
    reporter.onStdErr(SENTINEL);
    reporter.onTestEnd(testCase("a", "expected"), {
      errors: [{ message: SENTINEL }],
      attachments: [{ body: Buffer.from(SENTINEL) }],
    } as unknown as TestResult);
    reporter.onTestEnd(testCase("b", "skipped", "skipped", true));
    reporter.onEnd({ status: "passed", startTime: new Date(), duration: 1 });
    const json = readFileSync(outputFile, "utf8");
    const xml = readFileSync(junitFile, "utf8");
    expect(json + xml).not.toContain(SENTINEL);
    expect(json + xml).not.toContain(Buffer.from(SENTINEL).toString("base64"));
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(summarizePlaywrightReport(JSON.parse(json))).toMatchObject({
      ok: true,
      passed: 1,
      skipped: 1,
      skippedRequired: 0,
    });
    expect(
      runPolicy({ sensitive: true, outputName: "stage" }).reporter,
    ).toEqual([
      ["./tests/e2e/support/sensitive-reporter.ts", expect.any(Object)],
    ]);
    expect(reporter.printsToStdio()).toBe(true);
    expect(
      runPolicy({ sensitive: true, outputName: "stage" }).preserveOutput,
    ).toBe("never");
  });

  it("refuses injected sensitive-suite reporters before running tests", () => {
    vi.stubEnv("PW_TEST_REPORTER", "json");
    expect(() => runPolicy({ sensitive: true, outputName: "stage" })).toThrow(
      "SENSITIVE_SMOKE_REPORTER_OVERRIDE_REFUSED",
    );
  });

  it.each([
    "flaky",
    "unexpected",
    "required-skip",
    "expected-failure",
    "setup-error",
  ])("fails closed on %s without retaining its raw failure", (reason) => {
    const outputFile = join(temp(), "safe.json");
    const reporter = new SensitiveReporter({ outputFile });
    reporter.onTestEnd(testCase("passed", "expected"));
    if (reason === "setup-error")
      reporter.onError({ message: SENTINEL, stack: SENTINEL });
    else
      reporter.onTestEnd(
        testCase(
          "bad",
          reason === "required-skip"
            ? "skipped"
            : reason === "expected-failure"
              ? "expected"
              : reason,
          reason === "expected-failure"
            ? "failed"
            : reason === "required-skip"
              ? "skipped"
              : "passed",
        ),
      );
    reporter.onEnd({
      status: reason === "setup-error" ? "failed" : "passed",
      startTime: new Date(),
      duration: 1,
    });
    const json = readFileSync(outputFile, "utf8");
    expect(json).not.toContain(SENTINEL);
    expect(summarizePlaywrightReport(JSON.parse(json)).ok).toBe(false);
  });
});
