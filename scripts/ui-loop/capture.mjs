#!/usr/bin/env node
// UI improvement loop capture harness (docs/plans/ui-improvement-loop-2026-11-04).
// Local stack only: signs in a seeded test persona with a Clerk sign-in token,
// then captures every screen in a stage's screens.json with screenshots, an
// accessibility snapshot, axe results, console errors and page overflow.
//
//   node scripts/ui-loop/capture.mjs --stage 1 --loop 0 [--locales th,en]
//     [--themes light,dark] [--only id,id] [--out dir]
import { chromium } from "@playwright/test";
import { createClerkClient } from "@clerk/backend";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
process.loadEnvFile(".env.local");

const { values: args } = parseArgs({
  options: {
    stage: { type: "string" },
    loop: { type: "string", default: "0" },
    locales: { type: "string", default: "th" },
    themes: { type: "string", default: "light" },
    only: { type: "string" },
    out: { type: "string" },
  },
});
if (!args.stage) throw Error("--stage is required");

const base = process.env.NEXT_PUBLIC_APP_URL;
if (
  ![base, process.env.NEXT_PUBLIC_CONVEX_URL].every((url) =>
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url ?? ""),
  ) ||
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
  process.env.ALLOW_LOCAL_TEST_SEED !== "true"
)
  throw Error("Capture needs a loopback app, a Clerk test key and the seed");

const PLAN = "docs/plans/ui-improvement-loop-2026-11-04";
const spec = JSON.parse(
  readFileSync(`${PLAN}/stages/s${args.stage}/screens.json`, "utf8"),
);
const fixture = JSON.parse(readFileSync("output/local-test-data.json", "utf8"));
const out = resolve(
  args.out ?? `output/ui-loop/s${args.stage}/loop-${args.loop}`,
);
mkdirSync(out, { recursive: true });

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const PERSONAS = {
  admin: {
    userId:
      process.env.LOCAL_TEST_CLERK_USER_ID ??
      "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd",
    orgId:
      process.env.LOCAL_TEST_CLERK_ORG_ID ?? "org_3JXrDUraQjTRO3hcIzMGC9CvIXV",
  },
};
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

/** Replaces {fixture.path} placeholders, e.g. {warehouseId}. */
const fill = (text) =>
  text.replace(/\{([\w.]+)\}/g, (_, key) => {
    const value = key.split(".").reduce((o, k) => o?.[k], fixture);
    if (value === undefined) throw Error(`Unknown fixture key ${key}`);
    return String(value);
  });
const localized = (value, locale) =>
  typeof value === "object" && value !== null ? value[locale] : value;

async function signIn(browser, persona) {
  const who = PERSONAS[persona];
  if (!who) throw Error(`Unknown persona ${persona}`);
  const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const context = await browser.newContext();
  const page = await context.newPage();
  const ticket = await client.signInTokens.createSignInToken({
    userId: who.userId,
    orgId: who.orgId,
    expiresInSeconds: 300,
  });
  const url = new URL("/th/sign-in", base);
  url.searchParams.set("__clerk_ticket", ticket.token);
  url.searchParams.set("__clerk_status", "sign_in");
  url.searchParams.set("redirect_url", "/th/finished-goods");
  await page.goto(url.href, { timeout: 180_000 });
  await page.waitForURL("**/th/finished-goods", { timeout: 180_000 });
  await page.waitForFunction(() => window.Clerk?.session, null, {
    timeout: 60_000,
  });
  const sessionId = await page.evaluate(() => window.Clerk.session.id);
  const storageState = await context.storageState();
  await context.close();
  return {
    storageState,
    revoke: () => client.sessions.revokeSession(sessionId),
  };
}

async function runStep(page, step, locale) {
  const [kind, value] = Object.entries(step)[0];
  const target = (v) =>
    typeof v === "string"
      ? page.locator(fill(v)).first()
      : page
          .getByRole(v.role, { name: localized(v.name, locale), exact: false })
          .first();
  switch (kind) {
    case "click":
      return target(value).click({ timeout: 30_000 });
    case "hover":
      return target(value).hover({ timeout: 30_000 });
    case "fill":
      return target(value[0]).fill(localized(value[1], locale));
    case "type":
      return target(value[0]).pressSequentially(localized(value[1], locale), {
        delay: 40,
      });
    case "press":
      return page.keyboard.press(value);
    case "wait":
      return page.waitForTimeout(value);
    case "waitFor":
      return target(value).waitFor({ state: "visible", timeout: 60_000 });
    case "scroll":
      return target(value).scrollIntoViewIfNeeded();
    case "goto":
      return page.goto(new URL(`/${locale}${fill(value)}`, base).href);
    default:
      throw Error(`Unknown step ${kind}`);
  }
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForLoadState("networkidle", { timeout: 8_000 })
    .catch(() => {});
  await page.waitForTimeout(600);
}

async function captureOne(browser, auth, screen, locale, theme, vpName) {
  const name = `${screen.id}__${locale}-${vpName}-${theme}`;
  const context = await browser.newContext({
    ...VIEWPORTS[vpName],
    storageState:
      screen.persona === "anonymous" ? undefined : auth.storageState,
    colorScheme: theme,
    locale: locale === "th" ? "th-TH" : "en-US",
    timezoneId: "Asia/Bangkok",
    reducedMotion: "reduce",
  });
  // The Next.js dev indicator is not part of the product UI.
  await context.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.addEventListener("DOMContentLoaded", () =>
      document.head.append(style),
    );
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 400));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  // Backend unreachable: every Convex WebSocket is refused as soon as it opens.
  if (screen.block === "convex")
    await page.routeWebSocket(/127\.0\.0\.1:\d+\/api\//, (ws) =>
      ws.close({ code: 1006, reason: "capture: backend unreachable" }),
    );
  const result = { name, screen: screen.id, locale, theme, viewport: vpName };
  try {
    await page.goto(new URL(`/${locale}${fill(screen.path)}`, base).href, {
      timeout: 180_000,
    });
    if (screen.ready)
      await page
        .locator(fill(screen.ready))
        .first()
        .waitFor({ state: "visible", timeout: 90_000 });
    await settle(page);
    for (const step of screen.steps ?? []) await runStep(page, step, locale);
    await settle(page);
    result.url = page.url().replace(base, "");
    result.overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    await page.screenshot({
      path: join(out, `${name}.png`),
      fullPage: screen.fullPage ?? false,
      animations: "disabled",
    });
    writeFileSync(
      join(out, `${name}.aria.yml`),
      await page.locator("body").ariaSnapshot(),
    );
    await page.addScriptTag({ content: axeSource });
    const axe = await page.evaluate(() =>
      window.axe.run(document, {
        resultTypes: ["violations"],
        runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"],
      }),
    );
    result.axe = axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
      count: v.nodes.length,
    }));
  } catch (error) {
    result.error = String(error.message ?? error).slice(0, 500);
    await page
      .screenshot({ path: join(out, `${name}.failed.png`) })
      .catch(() => {});
  }
  result.consoleErrors = consoleErrors;
  await context.close();
  return result;
}

const browser = await chromium.launch();
const sessions = {};
const results = [];
try {
  const only = args.only?.split(",");
  const screens = spec.screens.filter((s) => !only || only.includes(s.id));
  for (const screen of screens) {
    const persona = screen.persona ?? "admin";
    if (persona !== "anonymous")
      sessions[persona] ??= await signIn(browser, persona);
    for (const locale of args.locales.split(","))
      for (const theme of args.themes.split(","))
        for (const vp of screen.viewports ?? ["mobile", "desktop"]) {
          const started = Date.now();
          const r = await captureOne(
            browser,
            sessions[persona],
            screen,
            locale,
            theme,
            vp,
          );
          const serious = (r.axe ?? []).filter((v) =>
            ["serious", "critical"].includes(v.impact),
          ).length;
          console.log(
            `${r.error ? "FAIL" : "ok  "} ${r.name} overflow=${r.overflowPx ?? "-"} axe-serious=${serious} console=${r.consoleErrors.length} ${((Date.now() - started) / 1000).toFixed(0)}s${r.error ? ` ${r.error.split("\n")[0]}` : ""}`,
          );
          results.push(r);
        }
  }
} finally {
  for (const s of Object.values(sessions)) await s.revoke().catch(() => {});
  await browser.close();
}
// --only recaptures some screens and keeps the rest of an existing capture.
const capturesPath = join(out, "captures.json");
if (args.only && existsSync(capturesPath)) {
  const previous = JSON.parse(readFileSync(capturesPath, "utf8")).results;
  const redone = new Set(results.map((r) => r.name));
  results.unshift(...previous.filter((r) => !redone.has(r.name)));
}
writeFileSync(
  capturesPath,
  `${JSON.stringify({ stage: Number(args.stage), loop: Number(args.loop), capturedAt: new Date().toISOString(), screens: spec.screens.map(({ id, title, state, notes }) => ({ id, title, state, notes })), results }, null, 2)}\n`,
);
const failed = results.filter((r) => r.error).length;
console.log(`\n${results.length - failed}/${results.length} captured → ${out}`);
process.exitCode = failed ? 1 : 0;
