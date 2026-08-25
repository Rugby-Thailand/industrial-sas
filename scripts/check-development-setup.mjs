import { isPublishableKey } from "@clerk/shared/keys";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const envPath = join(repoRoot, ".env.local");

if (!existsSync(envPath)) {
  process.stderr.write(
    "Development setup incomplete: .env.local is missing. Copy .env.example, then follow docs/development-setup.md.\n",
  );
  process.exit(1);
}

const environment = parseEnv(readFileSync(envPath, "utf8"));
const problems = [];
const warnings = [];

const required = [
  "CONVEX_DEPLOYMENT",
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_JWT_ISSUER_DOMAIN",
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
];

for (const name of required) {
  if (!present(environment.get(name))) problems.push(`${name} is missing`);
}

if (present(environment.get("CONVEX_DEPLOY_KEY"))) {
  problems.push("CONVEX_DEPLOY_KEY must not be stored on a developer machine");
}
checkPrefix("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_");
checkPrefix("CLERK_SECRET_KEY", "sk_test_");
const publishableKey = environment
  .get("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
  ?.trim();
if (present(publishableKey) && !isPublishableKey(publishableKey)) {
  problems.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is malformed");
}
const expectedIssuer = issuerFromPublishableKey(publishableKey);
if (
  expectedIssuer !== undefined &&
  environment.get("CLERK_JWT_ISSUER_DOMAIN")?.trim() !== expectedIssuer
) {
  problems.push(
    "CLERK_JWT_ISSUER_DOMAIN does not match NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  );
}
checkUrl("NEXT_PUBLIC_CONVEX_URL", ["https:", "http:"]);
checkUrl("NEXT_PUBLIC_APP_URL", ["http:", "https:"]);
checkUrl("CLERK_JWT_ISSUER_DOMAIN", ["https:"]);

const issuer = environment.get("CLERK_JWT_ISSUER_DOMAIN")?.trim();
if (present(issuer) && !issuer.endsWith(".clerk.accounts.dev")) {
  warnings.push(
    "CLERK_JWT_ISSUER_DOMAIN does not look like a Clerk development-instance domain",
  );
}

const deployment = environment.get("CONVEX_DEPLOYMENT")?.trim() ?? "";
const deploymentKind = deployment.startsWith("local:")
  ? "local"
  : deployment.startsWith("dev:")
    ? "cloud development"
    : "unrecognized";
if (present(deployment) && deploymentKind === "unrecognized") {
  warnings.push(
    "CONVEX_DEPLOYMENT is neither a local nor cloud development target",
  );
}

for (const warning of warnings) process.stdout.write(`Warning: ${warning}.\n`);

if (problems.length > 0) {
  process.stderr.write("Development setup incomplete:\n");
  for (const problem of problems) process.stderr.write(`  - ${problem}.\n`);
  process.exit(1);
}

process.stdout.write(
  `Development setup is ready (${deploymentKind} Convex deployment; ${required.length} required settings present; no values printed).\n`,
);

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function issuerFromPublishableKey(value) {
  if (!present(value) || !/^pk_(test|live)_/.test(value)) return undefined;
  const encoded = value.replace(/^pk_(test|live)_/, "");
  const host = Buffer.from(encoded, "base64")
    .toString("utf8")
    .replace(/\$$/, "");
  return /^[a-z0-9.-]+\.clerk\.accounts\.dev$/.test(host)
    ? `https://${host}`
    : undefined;
}

function checkPrefix(name, prefix) {
  const value = environment.get(name)?.trim();
  if (present(value) && !value.startsWith(prefix)) {
    problems.push(`${name} is not a development credential`);
  }
}

function checkUrl(name, protocols) {
  const value = environment.get(name)?.trim();
  if (!present(value)) return;
  try {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol)) {
      problems.push(`${name} uses an unsupported URL protocol`);
    }
  } catch {
    problems.push(`${name} is not an absolute URL`);
  }
}

function parseEnv(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match === null) continue;
    const [, name, rawValue] = match;
    const quoted = rawValue.trim();
    const value =
      quoted.length >= 2 &&
      ((quoted.startsWith('"') && quoted.endsWith('"')) ||
        (quoted.startsWith("'") && quoted.endsWith("'")))
        ? quoted.slice(1, -1)
        : quoted;
    values.set(name, value);
  }
  return values;
}
