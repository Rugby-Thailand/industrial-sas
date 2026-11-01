import { describe, expect, it } from "vitest";
import net from "node:net";
import { once } from "node:events";

import { assertHrEnvironment } from "../../scripts/lib/hr-e2e-env.mjs";
import { requireHrPortFree } from "../../scripts/lib/hr-e2e-ports.mjs";

const local = {
  CONVEX_DEPLOYMENT: "anonymous:anonymous-agent",
  NEXT_PUBLIC_APP_URL: "http://localhost:3100",
  NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3320",
  NEXT_PUBLIC_CONVEX_SITE_URL: "http://127.0.0.1:3321",
  ALLOW_LOCAL_TEST_SEED: "true",
  CLERK_SECRET_KEY: "sk_test_fixture",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("fixture.clerk.accounts.dev$").toString("base64")}`,
  CLERK_JWT_ISSUER_DOMAIN: "https://fixture.clerk.accounts.dev",
};

describe("real HR browser harness destination guards", () => {
  it("accepts the explicitly enabled loopback test environment", () => {
    expect(assertHrEnvironment(local)).toBe(local);
  });
  it.each([
    ["CONVEX_DEPLOYMENT", "prod:customer"],
    ["CONVEX_DEPLOYMENT", "dev:shared"],
    ["NEXT_PUBLIC_APP_URL", "https://production.example.com"],
    ["NEXT_PUBLIC_APP_URL", "http://localhost:3100@evil.example"],
    ["NEXT_PUBLIC_CONVEX_URL", "https://shared.convex.cloud"],
    ["NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210"],
    ["NEXT_PUBLIC_CONVEX_SITE_URL", "https://shared.convex.site"],
    ["ALLOW_LOCAL_TEST_SEED", "false"],
    ["CLERK_SECRET_KEY", "sk_live_PRIVATE_SENTINEL"],
    ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_fixture"],
    ["CLERK_JWT_ISSUER_DOMAIN", "https://different.clerk.accounts.dev"],
    ["CONVEX_DEPLOY_KEY", "PRIVATE_SENTINEL"],
    ["CONVEX_ADMIN_KEY", "PRIVATE_SENTINEL"],
    ["CONVEX_SELF_HOSTED_URL", "https://remote.example.com"],
    ["CONVEX_SELF_HOSTED_ADMIN_KEY", "PRIVATE_SENTINEL"],
    ["CLERK_API_URL", "https://remote.example.com"],
  ])("refuses unsafe %s without disclosing its value", (name, value) => {
    let diagnostic = "";
    try {
      assertHrEnvironment({ ...local, [name]: value });
    } catch (error) {
      diagnostic = (error as Error).message;
    }
    expect(diagnostic).toContain("HR_E2E_UNSAFE_ENVIRONMENT:");
    expect(diagnostic).not.toContain(value);
  });
});

it.each(["127.0.0.1", "::1"])(
  "refuses a real occupied %s service port",
  async (host) => {
    const server = net.createServer();
    server.listen({ host, port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test socket did not bind");
    try {
      await expect(requireHrPortFree(address.port)).rejects.toThrow(
        "HR_E2E_PORT_IN_USE",
      );
      expect(server.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
