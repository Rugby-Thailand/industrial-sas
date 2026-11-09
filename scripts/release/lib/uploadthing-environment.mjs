import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateBuildEnvironment } from "./env-contract.mjs";

/** Read-only release prerequisite. Capture the CLI output privately: its stdout
 * contains a server credential and its errors must never reach build logs.
 * The reviewed target/key contract is checked before starting the child.
 * Convex selects that exact deployment from the validated deployment key; its
 * CLI deliberately rejects --deployment when CONVEX_DEPLOY_KEY is set.
 * @param {Record<string, string | undefined>} env
 * @param {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptionsWithStringEncoding) => import("node:child_process").SpawnSyncReturns<string>} [execute]
 */
export function verifyUploadthingBackendEnvironment(env, execute = spawnSync) {
  const validated = validateBuildEnvironment(env, "pre");
  if (!validated.ok) return false;
  try {
    const result = execute(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../../node_modules/convex/bin/main.js", import.meta.url),
        ),
        "env",
        "get",
        "UPLOADTHING_TOKEN",
      ],
      {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20_000,
        maxBuffer: 65_536,
      },
    );
    return (
      !result.error &&
      result.status === 0 &&
      typeof result.stdout === "string" &&
      result.stdout.replace(/\r?\n$/, "") === env.UPLOADTHING_TOKEN
    );
  } catch {
    return false;
  }
}
