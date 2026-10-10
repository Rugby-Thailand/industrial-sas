// Vercel CLI 63.1.0 emits a bare URL, a --json deployment object, or a
// noninteractive { status: "ok", deployment } envelope. Extract only its URL;
// provider messages, suggested commands, and errors never leave this boundary.
const ACCEPTED_STATES = new Set([
  "QUEUED",
  "INITIALIZING",
  "BUILDING",
  "READY",
]);
const NATIVE_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/;
const FAILURE =
  "Vercel deployment output was invalid; details were suppressed.";

function deploymentUrl(value) {
  if (typeof value !== "string") throw new Error(FAILURE);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(FAILURE);
  }
  if (
    url.protocol !== "https:" ||
    !NATIVE_HOST.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    ![url.origin, `${url.origin}/`].includes(value)
  )
    throw new Error(FAILURE);
  return url.origin;
}

export function parseVercelDeployOutput(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) throw new Error(FAILURE);
  const text = stdout.trim();
  if (text.startsWith("https://")) return deploymentUrl(text);
  let output;
  try {
    output = JSON.parse(text);
  } catch {
    throw new Error(FAILURE);
  }
  if (!output || typeof output !== "object" || Array.isArray(output))
    throw new Error(FAILURE);
  const wrapped =
    Object.hasOwn(output, "status") || Object.hasOwn(output, "deployment");
  if (wrapped && output.status !== "ok") throw new Error(FAILURE);
  const deployment = wrapped ? output.deployment : output;
  if (
    !deployment ||
    typeof deployment !== "object" ||
    Array.isArray(deployment) ||
    !/^dpl_[A-Za-z0-9]+$/.test(deployment.id ?? "") ||
    deployment.target !== "production" ||
    !ACCEPTED_STATES.has(deployment.readyState) ||
    Object.hasOwn(output, "error") ||
    Object.hasOwn(deployment, "error")
  )
    throw new Error(FAILURE);
  // The controller independently reads this deployment from Vercel and checks
  // project/account, production target, source SHA and run ID before using it.
  return deploymentUrl(deployment.url);
}
