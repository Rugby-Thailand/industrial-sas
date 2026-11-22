import { loadTargets, validateBuildEnvironment } from "./env-contract.mjs";

// A credential-bearing request can only go to these literal endpoints. The
// manifest and endpoint must agree before a build may contact either service.
const endpoints = new Map([
  ["production", "https://greedy-cardinal-537.convex.cloud/api/query"],
  ["staging", "https://befitting-stoat-208.convex.cloud/api/query"],
]);

/** Run the Convex CLI's single-variable system query over HTTPS. The reviewed
 * target selects a pinned endpoint. Only fixed diagnostic messages may reach build logs.
 * @param {Record<string, string | undefined>} env
 * @param {typeof fetch} [request]
 */
export async function verifyUploadthingBackendEnvironment(
  env,
  request = fetch,
) {
  const targets = loadTargets();
  const checked = validateBuildEnvironment(env, "pre", targets);
  if (!checked.ok || !checked.target) return "Invalid release environment.";
  const deployment = targets.targets[checked.target].convexDeployment;
  const endpoint = endpoints.get(checked.target);
  if (!endpoint || endpoint !== `https://${deployment}.convex.cloud/api/query`)
    return "The reviewed deployment does not match a pinned release endpoint.";
  const name = "UPLOADTHING_TOKEN";
  try {
    const response = await request(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Convex ${env.CONVEX_DEPLOY_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: "_system/cli/queryEnvironmentVariables:get",
        args: { name },
        format: "json",
      }),
    });
    if (response.status === 401 || response.status === 403)
      return "Convex denied the production or staging deployment key.";
    if (!response.ok) return "Convex rejected the environment query.";
    const result = await response.json();
    if (result?.status !== "success") return "Convex environment query failed.";
    if (result.value === null) return "UPLOADTHING_TOKEN is missing in Convex.";
    if (result.value?.name !== name || typeof result.value.value !== "string")
      return "Convex returned an invalid environment query response.";
    if (result.value.value !== env[name])
      return "UPLOADTHING_TOKEN must match between Next and the reviewed Convex deployment.";
    return null;
  } catch {
    return "Could not read the reviewed Convex environment over HTTPS.";
  }
}
