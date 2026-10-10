import type { BrowserContext } from "@playwright/test";

import { installStagingProtection } from "./protected-origin";

/**
 * Compatibility entry point for release/staging fixtures. Only reviewed
 * staging requests receive short-lived OIDC; production sends no protection
 * credentials. Every redirected request gets a fresh origin check.
 */
export async function scopeProtectionBypass(
  context: BrowserContext,
  baseUrl: string,
) {
  return installStagingProtection(context, {
    ...process.env,
    SMOKE_BASE_URL: baseUrl,
  });
}
