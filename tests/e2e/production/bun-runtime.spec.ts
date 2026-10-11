import { expect, test } from "../support/release-fixtures";
import { releaseSmokeInputs } from "../support/release-env";

test("@prod-safe serves the exact release on the Bun runtime", async ({
  request,
}) => {
  const { expectedSha } = releaseSmokeInputs();
  const response = await request.get("/api/runtime");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-release-sha"]).toBe(expectedSha);
  const status = await response.json();
  expect(status.runtime).toBe("bun");
  expect(status.version).toMatch(/^1\.4\.\d+$/);
  // The controller supplies RELEASE_SHA at build time. Vercel may omit it
  // from the serving process; the response header still binds this build.
  expect([null, expectedSha]).toContain(status.releaseSha);
});
