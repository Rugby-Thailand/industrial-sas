import { readFileSync } from "node:fs";

import { expect, test } from "../support/fixtures";

/** The production server under test runs on the pinned Bun, not Node. */
test.describe("server runtime", () => {
  test("Next serves requests under the pinned Bun runtime", async ({
    request,
  }) => {
    const pinned = readFileSync(".bun-version", "utf8").trim();
    const response = await request.get("/api/runtime");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toEqual({
      runtime: "bun",
      name: expect.any(String),
      version: pinned,
      // An unreleased local build publishes no release SHA.
      releaseSha: null,
    });
  });
});
