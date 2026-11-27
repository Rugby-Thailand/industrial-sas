import { appendFileSync } from "node:fs";

// Capture once after CI passes: downstream jobs must agree about why staging
// was skipped even if the repository variable changes during the release.
// An explicit staging dispatch exercises the gate even when it is disabled
// for production releases. Missing/invalid settings keep the gate enabled.
const enabled =
  process.env.STAGING_ONLY === "true" ||
  process.env.STAGING_ENABLED !== "false";
if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
appendFileSync(process.env.GITHUB_OUTPUT, `staging_enabled=${enabled}\n`);
console.log(`Staging gate: ${enabled ? "enabled" : "disabled"}`);
