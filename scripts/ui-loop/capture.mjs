#!/usr/bin/env node
// UI improvement loop capture harness (docs/plans/ui-improvement-loop-2026-11-04).
// Local stack only: signs in a seeded test persona with a Clerk sign-in token,
// then captures every screen in a stage's screens.json with screenshots, an
// accessibility snapshot, axe results, console errors and page overflow.
//
//   node scripts/ui-loop/capture.mjs --stage 1 --loop 0 [--locales th,en]
//     [--themes light,dark] [--only id,id] [--out dir]
//     [--capture-pair-module scripts/ui-loop/<stage>/capture-pair.mjs]
// A pair adapter exports capturePair({page, screen, locale, name, out,
// screenshotOptions}); it owns PNG/ARIA persistence and may return receipt
// metadata. Throwing fails the capture; there is no unvalidated fallback.
//
// Scan screens (Stage 2) may also set, per screen:
//   camera: "deny" | "unavailable" | "<y4m/mjpeg path>"  getUserMedia rejects
//     (NotAllowedError), is missing, or plays the file as a Chromium fake
//     camera (a separate browser per file, camera permission granted);
//   retries: n  rerun a failed capture up to n times (for steps that depend
//     on the app's time-boxed on-device barcode reader);
//   after: [steps]  run once the capture is saved, e.g. to remove a record the
//     screen created (a failure there marks the capture FAIL).
// and use the step { files: [inputSelector, path | [paths]] } to choose files
// in an <input type=file>. Assets: node scripts/ui-loop/scan-assets.mjs.
import { chromium } from "@playwright/test";
import { createClerkClient } from "@clerk/backend";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
process.loadEnvFile(".env.local");

const { values: args } = parseArgs({
  options: {
    stage: { type: "string" },
    loop: { type: "string", default: "0" },
    locales: { type: "string", default: "th" },
    themes: { type: "string", default: "light" },
    // Explicit locale-theme pairs, e.g. th-light,en-dark (overrides the product
    // of --locales × --themes).
    variants: { type: "string" },
    only: { type: "string" },
    out: { type: "string" },
    "changes-from": { type: "string" },
    "capture-pair-module": { type: "string" },
  },
});
if (!args.stage) throw Error("--stage is required");
// A stage may validate and persist a consistent PNG/ARIA pair. Resolve the
// optional local adapter before creating browsers or authentication sessions.
const capturePair = args["capture-pair-module"]
  ? (await import(pathToFileURL(resolve(args["capture-pair-module"])).href))
      .capturePair
  : undefined;
if (args["capture-pair-module"] && typeof capturePair !== "function")
  throw Error("Capture pair module must export a capturePair function");

// UI_LOOP_BASE_URL points captures at the production loop server (next start).
const base = process.env.UI_LOOP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
if (
  ![base, process.env.NEXT_PUBLIC_CONVEX_URL].every((url) =>
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url ?? ""),
  ) ||
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
  process.env.ALLOW_LOCAL_TEST_SEED !== "true"
)
  throw Error("Capture needs a loopback app, a Clerk test key and the seed");

const variants = args.variants
  ? args.variants.split(",").map((v) => v.split("-"))
  : args.locales
      .split(",")
      .flatMap((l) => args.themes.split(",").map((t) => [l, t]));
const PLAN = "docs/plans/ui-improvement-loop-2026-11-04";
const spec = JSON.parse(
  readFileSync(`${PLAN}/stages/s${args.stage}/screens.json`, "utf8"),
);
const fixture = JSON.parse(readFileSync("output/local-test-data.json", "utf8"));
const out = resolve(
  args.out ?? `output/ui-loop/s${args.stage}/loop-${args.loop}`,
);
mkdirSync(out, { recursive: true });

// Change records (changes-*.json) from this loop and any --changes-from loops.
const changes = [
  out,
  ...(args["changes-from"]?.split(",") ?? []).map((k) =>
    resolve(`output/ui-loop/s${args.stage}/loop-${k}`),
  ),
].flatMap((d) =>
  existsSync(d)
    ? readdirSync(d)
        .filter((f) => /^changes(-.*)?\.json$/.test(f))
        .flatMap((f) => JSON.parse(readFileSync(join(d, f), "utf8")))
    : [],
);

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
      : v.text
        ? page.getByText(localized(v.text, locale)).first()
        : page
            .getByRole(v.role, {
              name: localized(v.name, locale),
              exact: false,
            })
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
    case "files":
      return target(value[0]).setInputFiles(
        [value[1]].flat().map((file) => resolve(root, file)),
      );
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
  // Deterministic pending-state evidence: keep this request in the browser
  // until the context closes, without contacting the provider or faking UI.
  if (screen.holdRequest)
    await page.route(new URL(screen.holdRequest, base).href, () => {});
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 400));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  if (screen.camera === "deny" || screen.camera === "unavailable")
    await context.addInitScript((mode) => {
      if (mode === "unavailable")
        Object.defineProperty(navigator, "mediaDevices", { value: undefined });
      else
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          value: () =>
            Promise.reject(new DOMException("Denied", "NotAllowedError")),
        });
    }, screen.camera);
  else if (screen.camera)
    await context.grantPermissions(["camera"], { origin: base });
  // Backend unreachable: every Convex WebSocket is refused as soon as it opens.
  if (screen.block === "convex")
    await page.routeWebSocket(/127\.0\.0\.1:\d+\/api\//, (ws) =>
      ws.close({ code: 1006, reason: "capture: backend unreachable" }),
    );
  // Temporary read failure: the named Convex query fails; everything else works.
  if (screen.failQuery)
    await page.routeWebSocket(/127\.0\.0\.1:\d+\/api\//, (ws) => {
      const server = ws.connectToServer();
      const failing = new Set();
      ws.onMessage((message) => {
        try {
          const m = JSON.parse(message);
          if (m.type === "ModifyQuerySet")
            for (const q of m.modifications)
              if (
                q.type === "Add" &&
                q.udfPath.replace(".js:", ":") === screen.failQuery
              )
                failing.add(q.queryId);
        } catch {}
        server.send(message);
      });
      server.onMessage((message) => {
        try {
          const m = JSON.parse(message);
          if (
            m.type === "Transition" &&
            m.modifications.some((q) => failing.has(q.queryId))
          ) {
            m.modifications = m.modifications.map((q) =>
              failing.has(q.queryId) && q.type === "QueryUpdated"
                ? {
                    type: "QueryFailed",
                    queryId: q.queryId,
                    errorMessage: "capture: simulated temporary read failure",
                    logLines: [],
                    journal: q.journal,
                  }
                : q,
            );
            return ws.send(JSON.stringify(m));
          }
        } catch {}
        ws.send(message);
      });
    });
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
    // A successful screenshot must still show the state named by its spec.
    if (screen.captureReady)
      await page.locator(screen.captureReady).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });
    result.url = page.url().replace(base, "");
    result.overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    // Marker boxes (CSS px, viewport-relative) for the annotated before/after.
    const marks = changes.filter((c) => c.screen === screen.id);
    if (marks.length)
      result.boxes = await Promise.all(
        marks.map(async (c) => {
          const box = await page
            .locator(c.locator)
            .first()
            .boundingBox({ timeout: 2_000 })
            .catch(() => null);
          return { locator: c.locator, box };
        }),
      );
    // Capture the requested state, not the incidental hover left by a setup click.
    await page.mouse.move(0, 0);
    const screenshotOptions = {
      path: join(out, `${name}.png`),
      fullPage: screen.fullPage ?? false,
      animations: "disabled",
    };
    if (capturePair) {
      result.capturePair = await capturePair({
        page,
        screen,
        locale,
        name,
        out,
        screenshotOptions,
      });
    } else {
      await page.screenshot(screenshotOptions);
      writeFileSync(
        join(out, `${name}.aria.yml`),
        await page.locator("body").ariaSnapshot(),
      );
    }
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
    for (const step of screen.after ?? []) await runStep(page, step, locale);
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
// One Chromium per fake-camera file: the feed is a launch flag.
const cameraBrowsers = {};
function browserFor(screen) {
  if (!screen.camera || ["deny", "unavailable"].includes(screen.camera))
    return browser;
  const file = resolve(root, screen.camera);
  if (!existsSync(file))
    throw Error(`Missing camera asset ${screen.camera}; run scan-assets.mjs`);
  return (cameraBrowsers[file] ??= chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${file}`,
    ],
  }));
}
const sessions = {};
const results = [];
try {
  const only = args.only?.split(",");
  const screens = spec.screens.filter((s) => !only || only.includes(s.id));
  for (const screen of screens) {
    const persona = screen.persona ?? "admin";
    if (persona !== "anonymous")
      sessions[persona] ??= await signIn(browser, persona);
    for (const [locale, theme] of variants)
      for (const vp of screen.viewports ?? ["mobile", "desktop"]) {
        const started = Date.now();
        let r;
        // `retries` (per screen) reruns a failed capture in a fresh context.
        for (let attempt = 0; ; attempt++) {
          r = await captureOne(
            await browserFor(screen),
            sessions[persona],
            screen,
            locale,
            theme,
            vp,
          );
          if (!r.error || attempt >= (screen.retries ?? 0)) break;
          console.log(`retry ${r.name}: ${r.error.split("\n")[0]}`);
          r = undefined;
        }
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
  for (const b of Object.values(cameraBrowsers))
    await (await b).close().catch(() => {});
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
