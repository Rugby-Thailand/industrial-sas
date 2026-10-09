import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  GITHUB_MAIN_REF_URL,
  requestStagingOidc,
  smokeEnvironment,
  validateReleaseRuntime,
  validateReleaseSource,
  validateOidcLifetime,
  withStagingOidcFile,
} from "../../scripts/release/lib/entrypoint.mjs";

const repository = "Rugby-Thailand/industrial-sas";
const trusted = {
  GITHUB_ACTIONS: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: repository,
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "push",
  GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/quality.yml@refs/heads/main`,
  GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "42",
  RELEASE_ENVIRONMENT: "production",
};

describe("trusted release process boundary", () => {
  it("binds the credential-bearing ref lookup to the reviewed repository main branch", () => {
    expect(validateReleaseSource({ repository, releaseBranch: "main" })).toBe(
      true,
    );
    expect(GITHUB_MAIN_REF_URL).toBe(
      "https://api.github.com/repos/Rugby-Thailand/industrial-sas/git/ref/heads/main",
    );
    for (const source of [
      null,
      {},
      { repository: "fork/industrial-sas", releaseBranch: "main" },
      { repository: `${repository}?secret=sentinel`, releaseBranch: "main" },
      { repository: `${repository}/../other`, releaseBranch: "main" },
      { repository, releaseBranch: "feature" },
      { repository, releaseBranch: "main?secret=sentinel" },
      { repository, releaseBranch: "../main" },
      { repository, releaseBranch: ["main"] },
    ]) {
      expect(validateReleaseSource(source)).toBe(false);
    }
    const fork = "fork/industrial-sas";
    expect(
      validateReleaseRuntime(
        {
          ...trusted,
          GITHUB_REPOSITORY: fork,
          GITHUB_WORKFLOW_REF: `${fork}/.github/workflows/quality.yml@refs/heads/main`,
        },
        "production",
        fork,
      ),
    ).toBe(false);
  });

  it("requires enough OIDC lifetime and removes its private file after browser execution", async () => {
    const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url")}.signature`;
    expect(() => validateOidcLifetime("invalid")).toThrow("malformed");
    const expired = `header.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.signature`;
    expect(() => validateOidcLifetime(expired)).toThrow("lifetime");
    let observedPath = "";
    const result = await withStagingOidcFile(
      {},
      async (path: string, signal: AbortSignal) => {
        observedPath = path;
        expect(readFileSync(path, "utf8")).toBe(token);
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(signal.aborted).toBe(false);
        return "safe-result";
      },
      async () => token,
    );
    expect(result).toBe("safe-result");
    expect(existsSync(observedPath)).toBe(false);
  });

  it("does not launch browser work if refreshing the credential fails", async () => {
    const work = vi.fn();
    await expect(
      withStagingOidcFile({}, work, async () => {
        throw new Error("provider-sentinel");
      }),
    ).rejects.toThrow("Staging OIDC refresh failed");
    expect(work).not.toHaveBeenCalled();
  });
  it("rejects external, pull-request, incorrect-workflow and non-main execution", () => {
    expect(validateReleaseRuntime(trusted, "production", repository)).toBe(
      true,
    );
    expect(
      validateReleaseRuntime(
        { ...trusted, GITHUB_EVENT_NAME: "workflow_dispatch" },
        "production",
        repository,
      ),
    ).toBe(true);
    for (const patch of [
      { GITHUB_ACTIONS: "false" },
      { GITHUB_SERVER_URL: "https://example.invalid" },
      { GITHUB_REPOSITORY: "fork/industrial-sas" },
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_EVENT_NAME: "pull_request" },
      { GITHUB_EVENT_NAME: "pull_request_target" },
      { GITHUB_EVENT_NAME: "workflow_run" },
      {
        GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/other.yml@refs/heads/main`,
      },
      { RELEASE_ENVIRONMENT: "staging" },
      { GITHUB_SHA: "invalid" },
      { GITHUB_RUN_ID: "invalid" },
    ]) {
      expect(
        validateReleaseRuntime(
          { ...trusted, ...patch },
          "production",
          repository,
        ),
      ).toBe(false);
    }
  });

  it("browser subprocesses never inherit release or backup credentials", () => {
    const source = {
      VERCEL_TOKEN: "release-sentinel",
      GITHUB_TOKEN: "github-sentinel",
      GH_TOKEN: "gh-sentinel",
      CONVEX_BACKUP_ADMIN_KEY: "backup-sentinel",
      CONVEX_ADMIN_KEY: "admin-sentinel",
      CONVEX_SELF_HOSTED_ADMIN_KEY: "selfhosted-sentinel",
      CONVEX_DEPLOY_KEY: "stage-deploy-sentinel",
      CLERK_SECRET_KEY: "clerk-test-sentinel",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-request-sentinel",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid",
      PATH: "synthetic-path",
    };
    expect(smokeEnvironment(source, "staging")).toEqual({
      CONVEX_DEPLOY_KEY: source.CONVEX_DEPLOY_KEY,
      CLERK_SECRET_KEY: source.CLERK_SECRET_KEY,
      PATH: source.PATH,
    });
    expect(smokeEnvironment(source, "production")).toEqual({
      CLERK_SECRET_KEY: source.CLERK_SECRET_KEY,
      PATH: source.PATH,
    });
    expect(source.VERCEL_TOKEN).toBe("release-sentinel");
  });

  it("OIDC refuses absent or foreign issuer endpoints before sending the request secret", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(requestStagingOidc({}, transport)).rejects.toThrow(
      "job-scoped",
    );
    for (const endpoint of [
      "http://pipelines.actions.githubusercontent.com/token",
      "https://actions.githubusercontent.com.evil.invalid/token",
      "https://example.invalid/token",
    ]) {
      await expect(
        requestStagingOidc(
          {
            ACTIONS_ID_TOKEN_REQUEST_URL: endpoint,
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-sentinel",
          },
          transport,
        ),
      ).rejects.toThrow("endpoint");
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses the reviewed audience, bounded request and no redirects", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ value: "header.payload.signature" }));
    const result = await requestStagingOidc(
      {
        ACTIONS_ID_TOKEN_REQUEST_URL:
          "https://pipelines.actions.githubusercontent.com/token?existing=1",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-sentinel",
      },
      transport,
    );
    expect(result).toBe("header.payload.signature");
    const call = transport.mock.calls[0];
    expect(call).toBeDefined();
    const url = new URL(String(call?.[0]));
    expect(url.searchParams.get("audience")).toBe(
      "https://github.com/Rugby-Thailand",
    );
    expect(url.searchParams.get("existing")).toBe("1");
    expect(call?.[1]).toMatchObject({
      redirect: "error",
      headers: { authorization: "Bearer request-sentinel" },
    });
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses unsuccessful or malformed OIDC responses", async () => {
    const env = {
      ACTIONS_ID_TOKEN_REQUEST_URL:
        "https://pipelines.actions.githubusercontent.com/token",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-sentinel",
    };
    for (const response of [
      new Response("provider-sentinel", { status: 403 }),
      Response.json({ value: "invalid" }),
      Response.json({}),
    ]) {
      await expect(
        requestStagingOidc(
          env,
          vi.fn<typeof fetch>().mockResolvedValue(response),
        ),
      ).rejects.toThrow(/acquisition failed|response was invalid/);
    }
  });
});
