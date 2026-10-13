// Pure production frontend preparation. No deployment or backend credentials.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { decodePublishableKey, loadTargets } from "./env-contract.mjs";

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const RUN = /^\d{1,20}$/;
export function buildDeploymentId({
  runId,
  runAttempt,
  target,
  buildJob = "prebuilt",
}) {
  if (
    !RUN.test(runId ?? "") ||
    !RUN.test(runAttempt ?? "") ||
    !["production", "staging"].includes(target) ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(buildJob)
  )
    throw new Error("Prebuilt build identity is invalid");
  return `b${createHash("sha256").update(`${runId}/${runAttempt}/${target}/${buildJob}`).digest("hex").slice(0, 24)}`;
}

const PUBLIC_NAMES = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_OBSERVABILITY_SINK",
  "NEXT_PUBLIC_SPEED_INSIGHTS_ENABLED",
  "NEXT_PUBLIC_SENTRY_ENABLED",
  "NEXT_PUBLIC_SENTRY_DSN",
];
const FORBIDDEN = [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT",
  "CONVEX_ADMIN_KEY",
  "CONVEX_BACKUP_ADMIN_KEY",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CLERK_SECRET_KEY",
  "UPLOADTHING_TOKEN",
  "SENTRY_AUTH_TOKEN",
  "VERCEL_TOKEN",
  "GITHUB_TOKEN",
];

export function productionBuildConfig() {
  return {
    buildCommand: "pnpm build",
    installCommand: "pnpm install --frozen-lockfile",
    bunVersion: "1.4.x",
    git: { deploymentEnabled: false },
  };
}

/** Reject secret-bearing input; return only reviewed public build inputs. */
export function productionBuildEnvironment(input, targets = loadTargets()) {
  const problems = [];
  const targetName = input.RELEASE_ENVIRONMENT ?? "production";
  const target = targets.targets[targetName];
  if (!["production", "staging"].includes(targetName) || !target)
    throw new Error("Pure build requires a reviewed target");
  for (const name of FORBIDDEN) if (input[name]?.trim()) problems.push(name);
  for (const name of Object.keys(input))
    if (name.startsWith("NEXT_PUBLIC_") && !PUBLIC_NAMES.includes(name))
      problems.push(name);
  if (!SHA.test(input.RELEASE_SHA ?? "")) problems.push("RELEASE_SHA");
  if (!RUN.test(input.RELEASE_RUN_ID ?? "")) problems.push("RELEASE_RUN_ID");
  if (!RUN.test(input.RELEASE_RUN_ATTEMPT ?? ""))
    problems.push("RELEASE_RUN_ATTEMPT");
  const buildJob = input.RELEASE_BUILD_JOB ?? "prebuilt";
  const deploymentId = buildDeploymentId({
    runId: input.RELEASE_RUN_ID,
    runAttempt: input.RELEASE_RUN_ATTEMPT,
    target: targetName,
    buildJob,
  });
  const pk = decodePublishableKey(input.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (
    pk?.keyClass !== target.clerkKeyClass ||
    pk?.frontendHost !== target.clerkFrontendHost
  )
    problems.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  const expected = {
    NEXT_PUBLIC_APP_URL: target.appUrl,
    NEXT_PUBLIC_CONVEX_URL: `https://${target.convexDeployment}.convex.cloud`,
    NEXT_PUBLIC_CONVEX_SITE_URL: `https://${target.convexDeployment}.convex.site`,
  };
  for (const [name, value] of Object.entries(expected))
    if (input[name] !== value) problems.push(name);
  if (!/^\/(th|en)\/sign-in$/.test(input.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? ""))
    problems.push("NEXT_PUBLIC_CLERK_SIGN_IN_URL");
  if (problems.length)
    throw new Error(`Pure production build refused: ${problems.join(", ")}`);
  return Object.fromEntries([
    ...PUBLIC_NAMES.filter((name) => input[name] !== undefined).map((name) => [
      name,
      input[name],
    ]),
    ["RELEASE_ENVIRONMENT", targetName],
    ["RELEASE_SHA", input.RELEASE_SHA],
    ["RELEASE_RUN_ID", input.RELEASE_RUN_ID],
    ["RELEASE_RUN_ATTEMPT", input.RELEASE_RUN_ATTEMPT],
    ["RELEASE_BUILD_JOB", buildJob],
    ["NEXT_DEPLOYMENT_ID", deploymentId],
    ["BUN_OPTIONS", "--no-env-file"],
    ["NEXT_TELEMETRY_DISABLED", "1"],
    ["VERCEL_TELEMETRY_DISABLED", "1"],
    ["CI", "1"],
  ]);
}

/** All symlinks must resolve inside the portable output; hash names + content. */
export async function inspectBuildOutput(directory) {
  const root = await realpath(directory);
  const hash = createHash("sha256");
  let bytes = 0;
  let files = 0;
  let links = 0;
  let functions = 0;
  const architectures = new Set();
  async function walk(path) {
    for (const name of (await readdir(path)).sort()) {
      const entry = join(path, name);
      const stat = await lstat(entry);
      const label = relative(root, entry).replaceAll("\\", "/");
      if (stat.isSymbolicLink()) {
        const linkText = await readlink(entry);
        if (isAbsolute(linkText))
          throw new Error("Prebuilt output contains an absolute symlink");
        const destination = await realpath(entry);
        const rel = relative(root, destination);
        if (
          rel === ".." ||
          rel.startsWith("../") ||
          resolve(root, rel) !== destination
        )
          throw new Error("Prebuilt output contains an external symlink");
        hash.update(`link\0${label}\0${linkText}\0`);
        links++;
      } else if (stat.isDirectory()) {
        await walk(entry);
      } else if (stat.isFile()) {
        const content = await readFile(entry);
        if (label.startsWith("functions/") && name === ".vc-config.json") {
          const fn = JSON.parse(content.toString());
          if (
            fn.runtime !== "bun1.4.x" ||
            !["x86_64", "arm64"].includes(fn.architecture) ||
            !fn.handler ||
            Object.keys(fn.environment ?? {}).length
          )
            throw new Error(
              "Prebuilt function runtime/environment metadata is invalid",
            );
          functions++;
          architectures.add(fn.architecture);
        }
        hash.update(
          `file\0${label}\0${stat.mode & 0o777}\0${content.length}\0`,
        );
        hash.update(content);
        bytes += content.length;
        files++;
      } else {
        throw new Error("Prebuilt output contains an unsupported entry");
      }
    }
  }
  await walk(root);
  const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
  if (
    config.version !== 3 ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(config.deploymentId ?? "") ||
    config.deploymentId.startsWith("dpl_")
  )
    throw new Error("Prebuilt output version/deployment identity is invalid");
  if (functions === 0 || architectures.size !== 1)
    throw new Error("Prebuilt function architecture metadata is invalid");
  return {
    functions,
    architecture: [...architectures][0],
    digest: hash.digest("hex"),
    bytes,
    files,
    links,
    deploymentId: config.deploymentId,
  };
}

export function createBuildReceipt({
  environment,
  output,
  lockfileDigest,
  generatedDigest,
  targets = loadTargets(),
  toolchain,
}) {
  if (
    !DIGEST.test(lockfileDigest) ||
    !DIGEST.test(generatedDigest) ||
    !DIGEST.test(output.digest)
  )
    throw new Error("Prebuilt receipt digest is invalid");
  if (
    output.deploymentId !== environment.NEXT_DEPLOYMENT_ID ||
    !SHA.test(environment.RELEASE_SHA ?? "")
  )
    throw new Error("Prebuilt receipt identity is invalid");
  if (
    !toolchain ||
    toolchain.nodeMajor !== "24" ||
    toolchain.bun !== "1.4.3" ||
    toolchain.vercel !== "63.1.0" ||
    toolchain.next !== "16.3.8" ||
    toolchain.pnpm !== "10.33.2" ||
    !["linux", "darwin"].includes(toolchain.platform)
  )
    throw new Error("Prebuilt receipt toolchain is invalid");
  if (
    environment.NEXT_DEPLOYMENT_ID !==
    buildDeploymentId({
      runId: environment.RELEASE_RUN_ID,
      runAttempt: environment.RELEASE_RUN_ATTEMPT,
      target: environment.RELEASE_ENVIRONMENT ?? "production",
      buildJob: environment.RELEASE_BUILD_JOB,
    })
  )
    throw new Error("Prebuilt receipt build identity is invalid");
  const publicConfig = Object.fromEntries(
    PUBLIC_NAMES.filter((name) => environment[name] !== undefined).map(
      (name) => [name, environment[name]],
    ),
  );
  const targetName = environment.RELEASE_ENVIRONMENT ?? "production";
  const target = targets.targets[targetName];
  if (!["production", "staging"].includes(targetName) || !target)
    throw new Error("Prebuilt receipt target is invalid");
  return {
    version: 1,
    sha: environment.RELEASE_SHA,
    runId: environment.RELEASE_RUN_ID,
    runAttempt: environment.RELEASE_RUN_ATTEMPT,
    buildJob: environment.RELEASE_BUILD_JOB,
    toolchain,
    architecture: output.architecture,
    projectId: target.vercelProjectId,
    teamId: target.vercelTeamId,
    target: targetName,
    deploymentId: output.deploymentId,
    outputDigest: output.digest,
    outputBytes: output.bytes,
    lockfileDigest,
    generatedDigest,
    publicConfigDigest: createHash("sha256")
      .update(JSON.stringify(publicConfig))
      .digest("hex"),
  };
}

export async function verifyBuildReceipt(
  receipt,
  {
    directory,
    target = "production",
    sha,
    runId,
    runAttempt,
    buildJob = "prebuilt",
    toolchain,
    platform,
    architecture,
    projectId,
    teamId,
    lockfileDigest,
    generatedDigest,
    publicConfigDigest,
  },
) {
  if (
    receipt.version !== 1 ||
    receipt.target !== target ||
    receipt.sha !== sha ||
    receipt.runId !== runId ||
    receipt.runAttempt !== runAttempt ||
    receipt.buildJob !== buildJob ||
    receipt.deploymentId !==
      buildDeploymentId({ runId, runAttempt, target, buildJob }) ||
    !toolchain ||
    !receipt.toolchain ||
    Object.entries(toolchain).some(
      ([name, value]) => receipt.toolchain[name] !== value,
    ) ||
    receipt.toolchain.platform !== platform ||
    receipt.architecture !== architecture ||
    receipt.projectId !== projectId ||
    receipt.teamId !== teamId ||
    receipt.lockfileDigest !== lockfileDigest ||
    receipt.generatedDigest !== generatedDigest ||
    receipt.publicConfigDigest !== publicConfigDigest
  )
    throw new Error("Prebuilt receipt provenance mismatch");
  const output = await inspectBuildOutput(directory);
  if (
    output.digest !== receipt.outputDigest ||
    output.deploymentId !== receipt.deploymentId ||
    output.architecture !== architecture
  )
    throw new Error("Prebuilt receipt output mismatch");
  return output;
}
