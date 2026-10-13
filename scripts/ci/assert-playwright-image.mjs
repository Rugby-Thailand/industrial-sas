// Only the branch-only container probe may replace installation with this
// assertion. Exact lock/version and preinstalled executables fail closed.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { chromium, firefox, webkit } from "@playwright/test";

const require = createRequire(import.meta.url);
const version = require("@playwright/test/package.json").version;
if (
  version !== "1.62.1" ||
  process.env.PLAYWRIGHT_BROWSERS_PATH !== "/ms-playwright"
)
  throw new Error(
    "Probe browser image does not match the locked Playwright version/path",
  );
for (const [name, browser] of Object.entries({ chromium, firefox, webkit })) {
  if (!existsSync(browser.executablePath()))
    throw new Error(`Probe browser image is missing ${name}`);
}
console.log(
  `Verified preinstalled Playwright ${version}: Chromium, Firefox and WebKit`,
);
