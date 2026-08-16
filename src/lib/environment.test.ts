import { describe, expect, it } from "vitest";

import { resolveAppEnvironment } from "./environment";

const validClerkPublishableKey = `pk_test_${Buffer.from(
  "foo-bar-13.clerk.accounts.dev$",
).toString("base64")}`;

/**
 * The safety property this file exists for is the last block: preview mode
 * cannot be reached in production. Everything above it is the ordinary
 * classification the screens depend on.
 */
describe("resolveAppEnvironment", () => {
  it("reports no backend when the deployment URL is absent", () => {
    const environment = resolveAppEnvironment({});

    expect(environment.backendConfigured).toBe(false);
    expect(environment.convexUrl).toBeUndefined();
  });

  it("carries the deployment URL when one is configured", () => {
    const environment = resolveAppEnvironment({
      convexUrl: "https://example.convex.cloud",
    });

    expect(environment.backendConfigured).toBe(true);
    expect(environment.convexUrl).toBe("https://example.convex.cloud");
  });

  it("treats whitespace as absent, because whitespace is not configuration", () => {
    const environment = resolveAppEnvironment({
      convexUrl: "   ",
      clerkPublishableKey: "\t\n",
    });

    expect(environment.backendConfigured).toBe(false);
    expect(environment.identityConfigured).toBe(false);
  });

  it("reports an identity provider only when the publishable key is valid", () => {
    expect(resolveAppEnvironment({}).identityConfigured).toBe(false);
    expect(
      resolveAppEnvironment({ clerkPublishableKey: "pk_test_invalid" })
        .identityConfigured,
    ).toBe(false);
    expect(
      resolveAppEnvironment({
        clerkPublishableKey: validClerkPublishableKey,
      }).identityConfigured,
    ).toBe(true);
  });

  describe("preview mode", () => {
    it("is on for the exact opt-in outside production", () => {
      const environment = resolveAppEnvironment({
        localPreviewFlag: "1",
        nodeEnv: "development",
      });

      expect(environment.previewMode).toBe(true);
      expect(environment.dataSource).toBe("LOCAL_PREVIEW");
    });

    it.each(["0", "true", "yes", "on", "TRUE", "", " "])(
      "is off for %o, which is not the opt-in value",
      (flag) => {
        expect(
          resolveAppEnvironment({ localPreviewFlag: flag, nodeEnv: "test" })
            .previewMode,
        ).toBe(false);
      },
    );

    /*
     * The one that matters. `NODE_ENV` is statically replaced in the client
     * bundle, so this is not only a runtime refusal — the branch is not present
     * in a production build at all. The assertion is the runtime half of that
     * claim, and it is written as an exhaustive sweep rather than one case so
     * that a future condition that reads any other variable still cannot open
     * the door.
     */
    it("cannot be enabled in production by any combination of the other values", () => {
      const flags = ["1", "0", "true", "", undefined];
      const urls = ["https://example.convex.cloud", "", undefined];
      const keys = ["pk_live_x", "", undefined];

      for (const localPreviewFlag of flags) {
        for (const convexUrl of urls) {
          for (const clerkPublishableKey of keys) {
            const environment = resolveAppEnvironment({
              nodeEnv: "production",
              localPreviewFlag,
              convexUrl,
              clerkPublishableKey,
            });

            expect(environment.previewMode).toBe(false);
            expect(environment.dataSource).toBe("SERVER");
          }
        }
      }
    });
  });

  it("answers a frozen value, so a screen cannot edit the environment", () => {
    expect(Object.isFrozen(resolveAppEnvironment({}))).toBe(true);
  });
});
