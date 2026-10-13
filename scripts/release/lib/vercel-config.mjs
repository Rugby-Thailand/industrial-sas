// The Vercel project configuration used by every gated release deployment
// (R2/R3/R5). The release job writes it to `vercel.json` in its throwaway
// checkout; the coordinated cutover commits exactly this content, which also
// disables native Git builds. Trusted main CI releases deploy through the CLI;
// PR checks use credential-free local browsers, and staging is a separate
// protected project. Unreviewed branch builds must not inherit backend keys.

export const GATED_BUILD_COMMAND = [
  "node scripts/release/assert-deploy-env.mjs --phase=pre",
  "pnpm exec convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL" +
    // The exact source has already passed next typegen + TypeScript 6 in the
    // mandatory quality gate. Keep Convex's separate backend typecheck.
    " --cmd 'node scripts/release/assert-deploy-env.mjs --phase=build && CI_EXTERNAL_TYPECHECK=1 pnpm build'",
].join(" && ");

// Hosted Vercel Functions run on Bun (docs/operations/bun-runtime.md). Vercel
// accepts only "1.4.x" or "1.x" and manages the patch; 1.4.x matches the
// pinned local and CI Bun (.bun-version).
export const HOSTED_BUN_VERSION = "1.4.x";

export function gatedVercelConfig() {
  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    buildCommand: GATED_BUILD_COMMAND,
    bunVersion: HOSTED_BUN_VERSION,
    git: { deploymentEnabled: false },
  };
}

/**
 * Cutover readiness of a committed vercel.json. Before cutover the Git
 * integration still builds `main` with the dashboard command, so a gated
 * release would race it; the release refuses until every check is true,
 * including the committed hosted Bun runtime.
 */
export function cutoverState(committed) {
  const config = committed ?? {};
  const gitProductionDisabled = config.git?.deploymentEnabled === false;
  const buildCommandGated = config.buildCommand === GATED_BUILD_COMMAND;
  // No ignored-build-step shortcut may skip a gated production build.
  const noIgnoreCommand = config.ignoreCommand === undefined;
  // A missing or different runtime would silently release on Node instead.
  const bunRuntime = config.bunVersion === HOSTED_BUN_VERSION;
  return {
    ready:
      gitProductionDisabled &&
      buildCommandGated &&
      noIgnoreCommand &&
      bunRuntime,
    gitProductionDisabled,
    buildCommandGated,
    noIgnoreCommand,
    bunRuntime,
  };
}
