import { describe, expect, it } from "vitest";

import { resolveAppEnvironment } from "./environment";

const validClerkPublishableKey = `pk_test_${Buffer.from(
  "foo-bar-13.clerk.accounts.dev$",
).toString("base64")}`;

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

  it("answers a frozen value, so a screen cannot edit the environment", () => {
    expect(Object.isFrozen(resolveAppEnvironment({}))).toBe(true);
  });
});
