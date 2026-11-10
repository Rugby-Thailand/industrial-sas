import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  classifyConvexDeployKey,
  decodePublishableKey,
  validateBuildEnvironment,
} from "../../scripts/release/lib/env-contract.mjs";

import { verifyUploadthingBackendEnvironment } from "../../scripts/release/lib/uploadthing-environment.mjs";

/**
 * The build-time contract that runs before Convex pushes (R5). Every value
 * here is a syntactically valid placeholder, never a credential.
 */

const pk = (keyClass: "live" | "test", host: string) =>
  `pk_${keyClass}_${Buffer.from(`${host}$`).toString("base64")}`;

const SHA = "c".repeat(40);

const production = {
  RELEASE_ENVIRONMENT: "production",
  UPLOADTHING_TOKEN: "mock-provider-token",
  RELEASE_SHA: SHA,
  RELEASE_RUN_ID: "987654",
  VERCEL: "1",
  VERCEL_TARGET_ENV: "production",
  VERCEL_PROJECT_ID: "prj_XQbt4f38BNrAvf593UstPk76rRik",
  CONVEX_DEPLOY_KEY: "prod:greedy-cardinal-537|placeholder",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk("live", "clerk.thaipropertyai.com"),
  CLERK_SECRET_KEY: "sk_live_placeholder",
  CLERK_JWT_ISSUER_DOMAIN: "https://clerk.thaipropertyai.com",
  NEXT_PUBLIC_APP_URL: "https://app.thaipropertyai.com",
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/th/sign-in",
  NEXT_PUBLIC_CONVEX_SITE_URL: "https://greedy-cardinal-537.convex.site",
  NEXT_PUBLIC_CONVEX_URL: "https://greedy-cardinal-537.convex.cloud",
};

const staging = {
  ...production,
  RELEASE_ENVIRONMENT: "staging",
  VERCEL_PROJECT_ID: "prj_qrzHbzKt7oIKziO8wzI8GP00KAUA",
  CONVEX_DEPLOY_KEY: "dev:befitting-stoat-208|placeholder",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk(
    "test",
    "creative-doberman-56.clerk.accounts.dev",
  ),
  CLERK_SECRET_KEY: "sk_test_placeholder",
  CLERK_JWT_ISSUER_DOMAIN: "https://creative-doberman-56.clerk.accounts.dev",
  NEXT_PUBLIC_APP_URL: "https://industrial-sas-staging.vercel.app",
  NEXT_PUBLIC_CONVEX_SITE_URL: "https://befitting-stoat-208.convex.site",
  NEXT_PUBLIC_CONVEX_URL: "https://befitting-stoat-208.convex.cloud",
};

describe("release build environment contract", () => {
  it("accepts the reviewed production and staging configurations in both phases", () => {
    for (const env of [production, staging]) {
      for (const phase of ["pre", "build"] as const) {
        expect(validateBuildEnvironment(env, phase)).toMatchObject({
          ok: true,
          problems: [],
        });
      }
    }
  });

  it("refuses a Git-triggered or manual build that lacks release provenance", () => {
    const { RELEASE_SHA: _sha, RELEASE_RUN_ID: _run, ...git } = production;
    const result = validateBuildEnvironment(git, "pre");
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining(["RELEASE_SHA", "RELEASE_RUN_ID"]),
    );
    expect(
      validateBuildEnvironment(
        { ...production, VERCEL_GIT_COMMIT_SHA: "d".repeat(40) },
        "pre",
      ).problems,
    ).toContain("VERCEL_GIT_COMMIT_SHA (does not match RELEASE_SHA)");
  });

  it("refuses an unknown or missing release environment", () => {
    for (const value of [undefined, "", "preview", "PRODUCTION"]) {
      expect(
        validateBuildEnvironment(
          { ...production, RELEASE_ENVIRONMENT: value },
          "pre",
        ).ok,
      ).toBe(false);
    }
  });

  it("refuses crossed production and staging credentials", () => {
    const cases: [Record<string, string>, string][] = [
      [
        { ...production, CONVEX_DEPLOY_KEY: staging.CONVEX_DEPLOY_KEY },
        "CONVEX_DEPLOY_KEY",
      ],
      [
        { ...staging, CONVEX_DEPLOY_KEY: production.CONVEX_DEPLOY_KEY },
        "CONVEX_DEPLOY_KEY",
      ],
      [
        {
          ...production,
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
            staging.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
        },
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      ],
      [{ ...production, CLERK_SECRET_KEY: "sk_test_x" }, "CLERK_SECRET_KEY"],
      [{ ...staging, CLERK_SECRET_KEY: "sk_live_x" }, "CLERK_SECRET_KEY"],
      [
        { ...production, VERCEL_PROJECT_ID: staging.VERCEL_PROJECT_ID },
        "VERCEL_PROJECT_ID",
      ],
      [
        { ...production, NEXT_PUBLIC_APP_URL: staging.NEXT_PUBLIC_APP_URL },
        "NEXT_PUBLIC_APP_URL",
      ],
    ];
    for (const [env, name] of cases) {
      const result = validateBuildEnvironment(env, "pre");
      expect(result.ok, name).toBe(false);
      expect(result.problems.join("\n")).toContain(name);
    }
  });

  it("refuses preview, project, local and developer deployment selections", () => {
    for (const key of [
      "preview:trustera:industrial-sas|x",
      "project:trustera:industrial-sas|x",
      "prod:other-deployment-1|x",
      "malformed",
      "",
    ]) {
      expect(
        validateBuildEnvironment(
          { ...production, CONVEX_DEPLOY_KEY: key },
          "pre",
        ).ok,
      ).toBe(false);
    }
    expect(
      validateBuildEnvironment(
        { ...production, CONVEX_DEPLOYMENT: "dev:local-dev-1" },
        "pre",
      ).problems,
    ).toContain("CONVEX_DEPLOYMENT (developer selection must be unset)");
    expect(
      validateBuildEnvironment(
        { ...production, CONVEX_ADMIN_KEY: "prod:greedy-cardinal-537|x" },
        "pre",
      ).ok,
    ).toBe(false);
  });

  it("checks the Convex URL injected for the build phase only", () => {
    const wrong = {
      ...production,
      NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210",
    };
    expect(validateBuildEnvironment(wrong, "pre").ok).toBe(true);
    expect(validateBuildEnvironment(wrong, "build").problems).toContain(
      "NEXT_PUBLIC_CONVEX_URL (not the target deployment)",
    );
  });

  it("refuses a build outside a Vercel production target", () => {
    expect(
      validateBuildEnvironment({ ...production, VERCEL: "" }, "pre").ok,
    ).toBe(false);
    expect(
      validateBuildEnvironment(
        { ...production, VERCEL_TARGET_ENV: "preview" },
        "pre",
      ).ok,
    ).toBe(false);
  });

  it("does not require optional telemetry", () => {
    const result = validateBuildEnvironment(production, "build");
    expect(result.ok).toBe(true);
    expect(result.notes).toEqual(
      expect.arrayContaining(["NEXT_PUBLIC_OBSERVABILITY_SINK: not set"]),
    );
  });

  it("requires the server upload token for staging and production before backend deployment", () => {
    for (const env of [production, staging]) {
      for (const phase of ["pre", "build"] as const) {
        for (const token of [undefined, "", "   "]) {
          const result = validateBuildEnvironment(
            { ...env, UPLOADTHING_TOKEN: token },
            phase,
          );
          expect(result.ok).toBe(false);
          expect(result.problems).toContain("UPLOADTHING_TOKEN");
        }
      }
    }
  });

  it("refuses a crossed issuer or operator credential in the build", () => {
    for (const phase of ["pre", "build"] as const) {
      for (const patch of [
        { CLERK_JWT_ISSUER_DOMAIN: staging.CLERK_JWT_ISSUER_DOMAIN },
        { CLERK_JWT_ISSUER_DOMAIN: "" },
        { CONVEX_BACKUP_ADMIN_KEY: "prod:greedy-cardinal-537|placeholder" },
        { CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210" },
        { CONVEX_SELF_HOSTED_ADMIN_KEY: "placeholder" },
      ]) {
        expect(
          validateBuildEnvironment({ ...production, ...patch }, phase).ok,
        ).toBe(false);
      }
    }
  });

  it("names variables but never prints their values", () => {
    const leaky = {
      ...production,
      CONVEX_DEPLOY_KEY: "prod:wrong-1|SUPERSECRETVALUE",
      CLERK_SECRET_KEY: "sk_test_SUPERSECRETVALUE",
      UPLOADTHING_TOKEN: "SUPERSECRETVALUE",
    };
    const cli = spawnSync(
      process.execPath,
      ["scripts/release/assert-deploy-env.mjs", "--phase=pre"],
      {
        env: {
          PATH: process.env.PATH,
          ...leaky,
        } as unknown as NodeJS.ProcessEnv,
        encoding: "utf8",
      },
    );
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain("CONVEX_DEPLOY_KEY");
    expect(cli.stdout + cli.stderr).not.toContain("SUPERSECRETVALUE");

    const ok = spawnSync(
      process.execPath,
      ["scripts/release/assert-deploy-env.mjs", "--phase=build"],
      {
        env: {
          PATH: process.env.PATH,
          ...production,
        } as unknown as NodeJS.ProcessEnv,
        encoding: "utf8",
      },
    );
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("production build environment verified");
  });
});

describe("credential classification", () => {
  it("decodes Clerk publishable keys without network access", () => {
    expect(decodePublishableKey(pk("live", "clerk.example.com"))).toEqual({
      keyClass: "live",
      frontendHost: "clerk.example.com",
    });
    expect(decodePublishableKey("pk_live_not-base64-dollar")).toBeNull();
    expect(decodePublishableKey("sk_live_x")).toBeNull();
  });

  it("classifies Convex deploy key shapes", () => {
    expect(classifyConvexDeployKey("prod:greedy-cardinal-537|x")).toEqual({
      kind: "deployment",
      keyClass: "prod",
      deployment: "greedy-cardinal-537",
    });
    expect(classifyConvexDeployKey("preview:team:project|x").kind).toBe(
      "preview",
    );
    expect(classifyConvexDeployKey("project:team:project|x").kind).toBe(
      "project",
    );
    expect(classifyConvexDeployKey("nobar").kind).toBe("malformed");
  });
});

describe("upload callback release credential parity", () => {
  const answer = (stdout: string, status = 0) => ({
    pid: 1,
    output: [null, stdout, ""],
    stdout,
    stderr: "",
    signal: null,
    status,
  });
  it("privately reads only the reviewed deployment token before backend deployment", () => {
    for (const env of [production, staging]) {
      const execute = vi.fn(() => answer(env.UPLOADTHING_TOKEN + "\n"));
      expect(verifyUploadthingBackendEnvironment(env, execute)).toBe(true);
      expect(execute).toHaveBeenCalledWith(
        process.execPath,
        [
          expect.stringContaining("node_modules/convex/bin/main.js"),
          "env",
          "get",
          "UPLOADTHING_TOKEN",
        ],
        expect.objectContaining({
          env,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 20_000,
          maxBuffer: 65_536,
        }),
      );
      expect(JSON.stringify(execute.mock.calls[0]?.slice(0, 2))).not.toContain(
        env.UPLOADTHING_TOKEN,
      );
    }
  });
  it("refuses missing, mismatched, failed or truncated reads without exposing diagnostics", () => {
    for (const result of [
      answer(""),
      answer("other-app-token\n"),
      answer("token\n", 1),
      {
        ...answer(production.UPLOADTHING_TOKEN),
        error: new Error("private credential diagnostic"),
      },
    ]) {
      expect(
        verifyUploadthingBackendEnvironment(production, () => result),
      ).toBe(false);
    }
    expect(
      verifyUploadthingBackendEnvironment(production, () => {
        throw new Error("private credential diagnostic");
      }),
    ).toBe(false);
  });
  it("never contacts a deployment when provenance or target selection is invalid", () => {
    const execute = vi.fn(() => answer(production.UPLOADTHING_TOKEN));
    for (const env of [
      { ...production, RELEASE_SHA: "" },
      { ...production, CONVEX_DEPLOY_KEY: staging.CONVEX_DEPLOY_KEY },
      { ...production, CONVEX_DEPLOYMENT: "dev:local" },
    ]) {
      expect(verifyUploadthingBackendEnvironment(env, execute)).toBe(false);
    }
    expect(execute).not.toHaveBeenCalled();
  });
});

it("the real pre-deploy CLI refuses backend credential mismatch without logging captured secrets", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "upload-env-preflight-"));
  try {
    const preload = path.join(directory, "private-reader.mjs");
    writeFileSync(
      preload,
      `import childProcess from "node:child_process";
import {syncBuiltinESMExports} from "node:module";
childProcess.spawnSync = () => ({status: 0, stdout: "DIFFERENT_PRIVATE_BACKEND_TOKEN\\n", stderr: "PRIVATE_CLI_DIAGNOSTIC"});
syncBuiltinESMExports();`,
    );
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        "scripts/release/assert-deploy-env.mjs",
        "--phase=pre",
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        env: { ...production, PATH: process.env.PATH, NODE_ENV: "test" },
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("UPLOADTHING_TOKEN must match");
    for (const secret of [
      production.UPLOADTHING_TOKEN,
      "DIFFERENT_PRIVATE_BACKEND_TOKEN",
      "PRIVATE_CLI_DIAGNOSTIC",
    ])
      expect(run.stdout + run.stderr).not.toContain(secret);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
