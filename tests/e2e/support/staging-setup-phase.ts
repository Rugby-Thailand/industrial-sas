/** Fixed labels only: no credentials, fixture IDs or provider responses. */
export const STAGING_SETUP_PHASES = [
  "validate-inputs",
  "verify-instance",
  "testing-token",
  "create-user",
  "create-primary-organization",
  "create-other-organization",
  "verify-membership",
  "identity-webhooks",
  "prepare-backend",
  "ready",
] as const;

export type StagingSetupPhase = (typeof STAGING_SETUP_PHASES)[number];

export function reportStagingSetupPhase(phase: StagingSetupPhase) {
  process.stdout.write(`[staging-setup] ${phase}\n`);
}
