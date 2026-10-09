// The Vercel project configuration used by every gated release deployment
// (R2/R3/R5). The release job writes it to `vercel.json` in its throwaway
// checkout; the coordinated cutover commits exactly this content, which also
// disables native Git builds. Trusted main CI releases deploy through the CLI;
// PR checks use credential-free local browsers, and staging is a separate
// protected project. Unreviewed branch builds must not inherit backend keys.

export const GATED_BUILD_COMMAND = [
  "node scripts/release/assert-deploy-env.mjs --phase=pre",
  "pnpm exec convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL" +
    " --cmd 'node scripts/release/assert-deploy-env.mjs --phase=build && pnpm build'",
].join(" && ");

export function gatedVercelConfig() {
  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    buildCommand: GATED_BUILD_COMMAND,
    git: { deploymentEnabled: false },
  };
}

/**
 * Cutover readiness of a committed vercel.json. Before cutover the Git
 * integration still builds `main` with the dashboard command, so a gated
 * release would race it; the release refuses until both are true.
 */
export function cutoverState(committed) {
  const config = committed ?? {};
  const gitProductionDisabled = config.git?.deploymentEnabled === false;
  const buildCommandGated = config.buildCommand === GATED_BUILD_COMMAND;
  // No ignored-build-step shortcut may skip a gated production build.
  const noIgnoreCommand = config.ignoreCommand === undefined;
  return {
    ready: gitProductionDisabled && buildCommandGated && noIgnoreCommand,
    gitProductionDisabled,
    buildCommandGated,
    noIgnoreCommand,
  };
}
