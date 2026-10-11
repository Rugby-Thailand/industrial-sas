import { test as base } from "@playwright/test";

import reviewedTargets from "../../../scripts/release/targets.json";
import {
  MAX_NETWORK_DIAGNOSTICS,
  networkErrorsMessage,
} from "../../../scripts/release/lib/smoke-diagnostics.mjs";
import { scopeProtectionBypass } from "./protection";
import { protectRequestContext } from "./protected-origin";
import {
  type ObservedFailedRequest,
  type ObservedResponse,
  requestFailureDiagnostic,
  responseDiagnostic,
  reviewedNetworkOrigins,
} from "./release-network-diagnostics";

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
    // Per-fixture, bounded set of fixed network codes. They only annotate a
    // failure the console rules already raise: categories observed during the
    // test, not proof of which request caused it. Never a verdict by itself.
    const origins = reviewedNetworkOrigins(reviewedTargets, baseURL);
    const networkCodes = new Set<string>();
    // Once full, later events are not even read.
    const observe = (classify: () => string | undefined) => {
      if (networkCodes.size >= MAX_NETWORK_DIAGNOSTICS) return;
      const code = classify();
      if (code) networkCodes.add(code);
    };
    const response = (observed: ObservedResponse) =>
      observe(() => responseDiagnostic(origins, observed));
    const requestFailed = (observed: ObservedFailedRequest) =>
      observe(() => requestFailureDiagnostic(origins, observed));
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
    page.on("response", response);
    page.on("requestfailed", requestFailed);
    try {
      await runFixture(page);
      if (pageErrors)
        throw new Error(
          uncaughtErrors
            ? "SENSITIVE_SMOKE_UNCAUGHT_ERRORS"
            : networkErrors
              ? networkErrorsMessage(networkCodes)
              : "SENSITIVE_SMOKE_CONSOLE_ERRORS",
        );
      protection?.assertHealthy();
    } finally {
      page.off("pageerror", uncaught);
      page.off("console", consoleError);
      page.off("response", response);
      page.off("requestfailed", requestFailed);
      await protection?.dispose();
    }
  },
});

export { expect } from "@playwright/test";
