import { test as base } from "@playwright/test";

import { scopeProtectionBypass } from "./protection";
import { protectRequestContext } from "./protected-origin";

/**
 * Release-suite fixtures: the API `request` context and the browser context
 * both use redirect-safe, origin-scoped staging OIDC. No global credential
 * headers, permanent bypass cookie or recorded session is configured.
 */
export const test = base.extend({
  request: async ({ playwright, baseURL }, runFixture) => {
    const context = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
    });
    try {
      await runFixture(
        protectRequestContext(context, {
          ...process.env,
          ...(baseURL ? { SMOKE_BASE_URL: baseURL } : {}),
        }),
      );
    } finally {
      await context.dispose();
    }
  },
  page: async ({ page, context, baseURL }, runFixture) => {
    const protection = baseURL
      ? await scopeProtectionBypass(context, baseURL)
      : undefined;
    // Keep counts only: provider/page error strings may contain credentials.
    let pageErrors = 0;
    let uncaughtErrors = 0;
    let networkErrors = 0;
    const uncaught = () => {
      pageErrors += 1;
      uncaughtErrors += 1;
    };
    const consoleError = (message: { type(): string; text(): string }) => {
      if (message.type() === "error") {
        pageErrors += 1;
        // Classify in memory only. Never retain the provider's message/URL.
        if (message.text().startsWith("Failed to load resource"))
          networkErrors += 1;
      }
    };
    page.on("pageerror", uncaught);
    page.on("console", consoleError);
    try {
      await runFixture(page);
      if (pageErrors)
        throw new Error(
          uncaughtErrors
            ? "SENSITIVE_SMOKE_UNCAUGHT_ERRORS"
            : networkErrors
              ? "SENSITIVE_SMOKE_NETWORK_ERRORS"
              : "SENSITIVE_SMOKE_CONSOLE_ERRORS",
        );
      protection?.assertHealthy();
    } finally {
      page.off("pageerror", uncaught);
      page.off("console", consoleError);
      await protection?.dispose();
    }
  },
});

export { expect } from "@playwright/test";
