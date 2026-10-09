#!/usr/bin/env node
// Runs inside the Vercel build command before Convex pushes backend code.
// Usage: node scripts/release/assert-deploy-env.mjs --phase=pre|build
import { validateBuildEnvironment } from "./lib/env-contract.mjs";

const phaseArgument = process.argv.find((value) =>
  value.startsWith("--phase="),
);
const phase = phaseArgument?.slice("--phase=".length) ?? "";

const result = validateBuildEnvironment(process.env, phase);
const label = `[release-env:${phase || "?"}]`;
if (!result.ok) {
  console.error(
    `${label} Refusing to build${result.target ? ` for ${result.target}` : ""}. ` +
      "Fix these variables (values are never printed):",
  );
  for (const problem of result.problems)
    console.error(`${label}   - ${problem}`);
  process.exit(1);
}
console.log(`${label} ${result.target} build environment verified.`);
for (const note of result.notes) console.log(`${label}   ${note}`);
