import { test } from "../support/release-fixtures";
import { releaseSmokeInputs } from "../support/release-env";
import {
  verifyBunRuntime,
  waitForReleasedResponse,
} from "../support/release-readiness";

test("@prod-safe serves the exact release on the Bun runtime", async ({
  request,
}) => {
  const { expectedSha } = releaseSmokeInputs();
  const response = await waitForReleasedResponse(
    request,
    "/api/runtime",
    expectedSha,
  );
  await verifyBunRuntime(response, expectedSha);
});
