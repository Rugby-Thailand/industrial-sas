import {
  chmod,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildDeploymentId,
  createBuildReceipt,
  inspectBuildOutput,
  productionBuildEnvironment,
  verifyBuildReceipt,
} from "../../scripts/release/lib/prebuilt.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const input = {
  RELEASE_SHA: "c".repeat(40),
  RELEASE_RUN_ID: "987654",
  RELEASE_RUN_ATTEMPT: "2",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from("clerk.thaipropertyai.com$").toString("base64")}`,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/th/sign-in",
  NEXT_PUBLIC_APP_URL: "https://app.thaipropertyai.com",
  NEXT_PUBLIC_CONVEX_URL: "https://greedy-cardinal-537.convex.cloud",
  NEXT_PUBLIC_CONVEX_SITE_URL: "https://greedy-cardinal-537.convex.site",
};
const digest = "a".repeat(64);
const toolchain = {
  nodeMajor: "24",
  bun: "1.4.3",
  vercel: "63.1.0",
  next: "16.3.8",
  pnpm: "10.33.2",
  platform: "linux",
};
async function output(target = "production") {
  const root = await mkdtemp(join(tmpdir(), "prebuilt-contract-"));
  roots.push(root);
  const directory = join(root, "output");
  await mkdir(directory);
  await writeFile(
    join(directory, "config.json"),
    JSON.stringify({
      version: 3,
      deploymentId: buildDeploymentId({
        runId: input.RELEASE_RUN_ID,
        runAttempt: input.RELEASE_RUN_ATTEMPT,
        target,
      }),
    }),
  );
  await mkdir(join(directory, "functions/app.func"), { recursive: true });
  await writeFile(
    join(directory, "functions/app.func/.vc-config.json"),
    JSON.stringify({
      runtime: "bun1.4.x",
      architecture: "x86_64",
      handler: "index.js",
      environment: {},
    }),
  );
  await writeFile(join(directory, "index.js"), "module.exports = 1;");
  return { root, directory };
}

describe("pure production prebuilt contract", () => {
  it("refuses mutation and runtime credentials, unknown public inputs and mismatched production target", () => {
    for (const name of [
      "CONVEX_DEPLOY_KEY",
      "CLERK_SECRET_KEY",
      "UPLOADTHING_TOKEN",
      "SENTRY_AUTH_TOKEN",
      "VERCEL_TOKEN",
      "NEXT_PUBLIC_UNKNOWN",
    ]) {
      expect(() =>
        productionBuildEnvironment({ ...input, [name]: "never-print-this" }),
      ).toThrow(name);
    }
    expect(() =>
      productionBuildEnvironment({
        ...input,
        NEXT_PUBLIC_CONVEX_URL: "https://other.convex.cloud",
      }),
    ).toThrow("NEXT_PUBLIC_CONVEX_URL");
    expect(() =>
      productionBuildEnvironment({
        ...input,
        RELEASE_RUN_ID: "invalid",
        RELEASE_RUN_ATTEMPT: "9".repeat(20),
      }),
    ).toThrow("identity");
  });

  it("binds a staging artifact to its reviewed project and rejects production receipt reuse", async () => {
    const { directory } = await output("staging");
    const environment = productionBuildEnvironment({
      ...input,
      RELEASE_ENVIRONMENT: "staging",
      NEXT_PUBLIC_APP_URL: "https://industrial-sas-staging.vercel.app",
      NEXT_PUBLIC_CONVEX_URL: "https://befitting-stoat-208.convex.cloud",
      NEXT_PUBLIC_CONVEX_SITE_URL: "https://befitting-stoat-208.convex.site",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("creative-doberman-56.clerk.accounts.dev$").toString("base64")}`,
    });
    const receipt = createBuildReceipt({
      environment,
      output: await inspectBuildOutput(directory),
      lockfileDigest: digest,
      generatedDigest: digest,
      toolchain,
    });
    const expected = {
      directory,
      target: "staging",
      sha: input.RELEASE_SHA,
      runId: input.RELEASE_RUN_ID,
      runAttempt: input.RELEASE_RUN_ATTEMPT,
      platform: "linux",
      architecture: "x86_64",
      projectId: receipt.projectId,
      teamId: receipt.teamId,
      lockfileDigest: digest,
      generatedDigest: digest,
      toolchain,
      publicConfigDigest: receipt.publicConfigDigest,
    };
    expect(receipt.projectId).toBe("prj_qrzHbzKt7oIKziO8wzI8GP00KAUA");
    await expect(verifyBuildReceipt(receipt, expected)).resolves.toBeDefined();
    await expect(
      verifyBuildReceipt(receipt, { ...expected, target: "production" }),
    ).rejects.toThrow("provenance");
  });

  it("preserves internal portable links but rejects external and dangling links", async () => {
    const { root, directory } = await output();
    await symlink("index.js", join(directory, "internal.js"));
    expect((await inspectBuildOutput(directory)).links).toBe(1);
    await symlink(join(directory, "index.js"), join(directory, "absolute.js"));
    await expect(inspectBuildOutput(directory)).rejects.toThrow(
      "absolute symlink",
    );
    await rm(join(directory, "absolute.js"));
    await writeFile(join(root, "outside.js"), "outside");
    await symlink("../outside.js", join(directory, "external.js"));
    await expect(inspectBuildOutput(directory)).rejects.toThrow(
      "external symlink",
    );
    await rm(join(directory, "external.js"));
    await symlink("missing.js", join(directory, "dangling.js"));
    await expect(inspectBuildOutput(directory)).rejects.toThrow();
  });

  it("refuses stale runtime, baked credentials and executable mode tampering", async () => {
    const { directory } = await output();
    const path = join(directory, "functions/app.func/.vc-config.json");
    await writeFile(
      path,
      JSON.stringify({
        runtime: "nodejs24.x",
        architecture: "x86_64",
        handler: "index.js",
        environment: {},
      }),
    );
    await expect(inspectBuildOutput(directory)).rejects.toThrow(
      "runtime/environment",
    );
    await writeFile(
      path,
      JSON.stringify({
        runtime: "bun1.4.x",
        architecture: "x86_64",
        handler: "index.js",
        environment: { CLERK_SECRET_KEY: "synthetic-do-not-publish" },
      }),
    );
    await expect(inspectBuildOutput(directory)).rejects.toThrow(
      "runtime/environment",
    );
    await writeFile(
      path,
      JSON.stringify({
        runtime: "bun1.4.x",
        architecture: "x86_64",
        handler: "index.js",
        environment: {},
      }),
    );
    const before = await inspectBuildOutput(directory);
    await chmod(join(directory, "index.js"), 0o755);
    expect((await inspectBuildOutput(directory)).digest).not.toBe(
      before.digest,
    );
  });

  it("rejects output tampering and stale SHA/run/config receipt reuse", async () => {
    const { directory } = await output();
    const environment = productionBuildEnvironment(input);
    const inspected = await inspectBuildOutput(directory);
    const receipt = createBuildReceipt({
      environment,
      output: inspected,
      lockfileDigest: digest,
      generatedDigest: digest,
      toolchain,
    });
    const expected = {
      directory,
      sha: input.RELEASE_SHA,
      runId: input.RELEASE_RUN_ID,
      runAttempt: input.RELEASE_RUN_ATTEMPT,
      platform: "linux",
      architecture: "x86_64",
      projectId: receipt.projectId,
      teamId: receipt.teamId,
      lockfileDigest: digest,
      generatedDigest: digest,
      toolchain,
      publicConfigDigest: receipt.publicConfigDigest,
    };
    await expect(verifyBuildReceipt(receipt, expected)).resolves.toMatchObject({
      digest: inspected.digest,
    });
    for (const replacement of [
      { sha: "d".repeat(40) },
      { runId: "123" },
      { runAttempt: "3" },
      { architecture: "arm64" },
      { platform: "darwin" },
      { publicConfigDigest: "b".repeat(64) },
    ])
      await expect(
        verifyBuildReceipt(receipt, { ...expected, ...replacement }),
      ).rejects.toThrow("provenance");
    await writeFile(join(directory, "index.js"), "module.exports = 2;");
    await expect(verifyBuildReceipt(receipt, expected)).rejects.toThrow(
      "output mismatch",
    );
  });
});
