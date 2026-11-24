import { chromium, firefox, webkit } from "@playwright/test";

const engines = new Map([
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
]);
const requested = process.argv.slice(2);
if (requested.length === 0 || requested.some((name) => !engines.has(name))) {
  throw new Error("Specify one or more of chromium, firefox, webkit.");
}

for (const name of requested) {
  const browser = await engines
    .get(name)
    .launch({ headless: true, timeout: 15_000 });
  await browser.close();
  console.log(`Verified Playwright ${name}`);
}
