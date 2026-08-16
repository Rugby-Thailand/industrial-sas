import { describe, expect, it } from "vitest";

import { resolveAppAccess } from "./appAccess";

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
