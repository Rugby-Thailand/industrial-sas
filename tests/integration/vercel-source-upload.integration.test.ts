import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Vercel source upload exclusions", () => {
  it("excludes private output at root and nested paths while retaining the remote build contract", () => {
    // Vercel's pinned ignore parser uses gitignore syntax. Exercise that syntax
    // with a clean disposable git repository, without reading any secret files
    // or requiring the release CLI to be installed in credential-free PR jobs.
    const directory = mkdtempSync(join(tmpdir(), "vercel-source-policy-"));
    const policy = resolve(".vercelignore");
    const excluded = [
      ".env",
      ".env.production",
      "nested/.env.staging",
      "convex-staging.private.env",
      "playwright/.auth/state.json",
      ".auth/identity.json",
      "nested/.auth/session.json",
      "test-results/staging/state.json",
      "nested/test-results/result.json",
      "playwright-report/report.html",
      "blob-report/report.json",
      "coverage/coverage-summary.json",
      "release-output/backup-metadata.json",
      "data/import-staging/private.json",
      "data/private/backup.zip",
      "output/operator.json",
      "artifacts/private.zip",
      "tmp/credential.json",
      ".convex/local/state.json",
      ".next-preview/cache/trace",
      ".next-e2e/output.js",
      "tools/release/node_modules/vercel/index.js",
      "nested/service-account-private.json",
      "nested/private.key",
      "nested/credentials.json",
    ];
    const included = [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      ".npmrc",
      ".nvmrc",
      "tsconfig.json",
      "next.config.ts",
      "vercel.json",
      "src/app/page.tsx",
      "public/manifest.webmanifest",
      "convex/schema.ts",
      "convex/_generated/api.d.ts",
      "convex/_generated/server.js",
      "scripts/release/assert-deploy-env.mjs",
      "scripts/release/lib/env-contract.mjs",
      "scripts/release/targets.json",
      "tests/fixtures/public-function-contract.json",
      "tools/release/pnpm-lock.yaml",
    ];
    try {
      const initialized = spawnSync("git", ["init", "--quiet", "--template="], {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(initialized.status).toBe(0);
      const result = spawnSync(
        "git",
        [
          "-c",
          `core.excludesFile=${policy}`,
          "check-ignore",
          "--no-index",
          "--stdin",
        ],
        {
          cwd: directory,
          input: [...excluded, ...included].join("\n"),
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n").sort()).toEqual(
        [...excluded].sort(),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
