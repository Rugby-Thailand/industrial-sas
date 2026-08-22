import { existsSync } from "node:fs";
import { join } from "node:path";

import { APP_DIST } from "../../playwright.config";

/** Refuse to test an old or missing production build. */
export default function assertPrepared(): void {
  if (!existsSync(join(process.cwd(), APP_DIST, "BUILD_ID"))) {
    throw new Error(`No build in ${APP_DIST}. Run \`pnpm test:e2e\`.`);
  }
}
