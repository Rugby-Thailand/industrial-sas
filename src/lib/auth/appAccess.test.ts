import { afterEach, describe, expect, it, vi } from "vitest";

import { clerkIdentityConfigured, resolveAppAccess } from "./appAccess";

describe("private application access", () => {
  it("sends an anonymous browser to sign in", () => {
    expect(
      resolveAppAccess({
        identityConfigured: true,
        userId: undefined,
        orgId: undefined,
      }),
    ).toBe("SIGN_IN");
  });

  it("keeps a signed-in user without an active organization out of the app", () => {
    expect(
      resolveAppAccess({
        identityConfigured: true,
        userId: "user_1",
        orgId: undefined,
      }),
    ).toBe("ORGANIZATION_REQUIRED");
  });

  it("admits a signed-in user with an active organization", () => {
    expect(
      resolveAppAccess({
        identityConfigured: true,
        userId: "user_1",
        orgId: "org_1",
      }),
    ).toBe("APP");
  });

  it("never exposes the app when identity is not configured", () => {
    expect(
      resolveAppAccess({
        identityConfigured: false,
        userId: undefined,
        orgId: undefined,
      }),
    ).toBe("SIGN_IN");
  });
});

describe("server identity setup", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("requires both keys before rendering the Clerk sign-in flow", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      `pk_test_${Buffer.from("unit.clerk.accounts.dev$").toString("base64")}`,
    );
    vi.stubEnv("CLERK_SECRET_KEY", "");
    expect(clerkIdentityConfigured()).toBe(false);
    vi.stubEnv("CLERK_SECRET_KEY", "test-fixture");
    expect(clerkIdentityConfigured()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    expect(clerkIdentityConfigured()).toBe(false);
  });
});
