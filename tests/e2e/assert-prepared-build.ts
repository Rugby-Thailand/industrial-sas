import { existsSync } from "node:fs";
import { join } from "node:path";

import { APP_DIST, PREVIEW_BASE_URL } from "../../playwright.config";

/**
 * Fail before the first browser starts if the run was not prepared.
 *
 * Two servers, and neither is Playwright's to create. The unconfigured one is
 * `next start` over a build in `APP_DIST`, and the preview one is a development
 * server that `scripts/run-e2e.mjs` starts, warms, and stops — deliberately not
 * declared in the config, because a second `next dev` over an already-warmed
 * build directory is one of the two measured ways to corrupt its manifests.
 *
 * So a bare `playwright test` has a stale or missing build and no preview server
 * at all. Saying which is far better than 123 specs failing on a dead port and a
 * Next error about a missing production build.
 */
export default async function assertPrepared(): Promise<void> {
  if (!existsSync(join(process.cwd(), APP_DIST, "BUILD_ID"))) {
    throw new Error(
      `No production build in ${APP_DIST}. Run \`pnpm test:e2e\`, which prepares ` +
        "both servers before starting the suite.",
    );
  }

  try {
    await fetch(PREVIEW_BASE_URL, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error(
      `No preview server on ${PREVIEW_BASE_URL}. Run \`pnpm test:e2e\`, which ` +
        "starts and warms it before the suite and stops it afterwards.",
    );
  }
}
