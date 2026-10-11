import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as route from "./route";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const originalBun = Object.getOwnPropertyDescriptor(process.versions, "bun");

beforeEach(() => {
  Object.defineProperty(process.versions, "bun", {
    value: undefined,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalBun) Object.defineProperty(process.versions, "bun", originalBun);
  else Reflect.deleteProperty(process.versions, "bun");
});

async function probe() {
  const response = route.GET();
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe("GET /api/runtime", () => {
  it("is dynamic, uncached and reports the serving Node runtime", async () => {
    vi.stubEnv("RELEASE_SHA", "");
    expect(route.dynamic).toBe("force-dynamic");
    const { response, body } = await probe();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      runtime: "node",
      name: process.release.name,
      version: process.versions.node,
      releaseSha: null,
    });
  });

  it("reports Bun and its version when Bun serves the request", async () => {
    Object.defineProperty(process.versions, "bun", {
      value: "1.4.3",
      configurable: true,
      enumerable: true,
    });
    vi.stubEnv("RELEASE_SHA", SHA);
    const { body } = await probe();
    expect(body).toMatchObject({
      runtime: "bun",
      version: "1.4.3",
      releaseSha: SHA,
    });
  });

  it("exposes only the four runtime keys and drops a malformed SHA", async () => {
    vi.stubEnv("RELEASE_SHA", `${SHA}\nX-Injected: 1`);
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_should_never_leak");
    const { response, body } = await probe();
    expect(Object.keys(body).sort()).toEqual([
      "name",
      "releaseSha",
      "runtime",
      "version",
    ]);
    expect(body.releaseSha).toBeNull();
    expect(JSON.stringify(body)).not.toContain("sk_test");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it.each([`${SHA}\n`, `${SHA}\r\n`, SHA.toUpperCase(), `${SHA}0`])(
    "rejects a value that is not exactly a lowercase commit SHA (%j)",
    async (value) => {
      vi.stubEnv("RELEASE_SHA", value);
      expect((await probe()).body.releaseSha).toBeNull();
    },
  );
});
