import { appendFileSync } from "node:fs";

// Capture once after CI passes: downstream jobs must agree about why staging
// was skipped even if the repository variable changes during the release.
// Only an explicit false disables the gate; missing/invalid values enable it.
const enabled = process.env.STAGING_ENABLED === "false" ? "false" : "true";
if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
appendFileSync(process.env.GITHUB_OUTPUT, `staging_enabled=${enabled}\n`);
console.log(`Staging gate: ${enabled === "true" ? "enabled" : "disabled"}`);
