import { describe, expect, it } from "vitest";

import { parseVercelDeployOutput } from "../../scripts/release/lib/vercel-cli-output.mjs";

const url = "https://industrial-sas-candidate-rugby.vercel.app";
const deployment = {
  id: "dpl_SyntheticCandidate42",
  url,
  readyState: "BUILDING",
  target: "production",
  productionUrl: "https://app.thaipropertyai.com",
  inspectorUrl: "https://vercel.com/synthetic/project/candidate",
  deploymentApiUrl:
    "https://api.vercel.com/v13/deployments/dpl_SyntheticCandidate42",
};

describe("pinned Vercel deployment stdout", () => {
  it("extracts the native URL from pretty noninteractive JSON, ignoring prose and provider fields", () => {
    const output = JSON.stringify(
      {
        status: "ok",
        deployment,
        message: "provider-secret-sentinel",
        next: [{ command: "private-command-sentinel" }],
      },
      null,
      2,
    );
    expect(parseVercelDeployOutput(`${output}\n`)).toBe(url);
  });

  it("supports bare --json results and the legacy single URL without assuming the last line", () => {
    expect(parseVercelDeployOutput(JSON.stringify(deployment))).toBe(url);
    expect(parseVercelDeployOutput(`  ${url}\n`)).toBe(url);
    expect(parseVercelDeployOutput(`${url}/`)).toBe(url);
  });

  it.each(["QUEUED", "INITIALIZING", "BUILDING", "READY"])(
    "allows %s while the controller waits for and independently verifies readiness",
    (readyState) => {
      expect(
        parseVercelDeployOutput(JSON.stringify({ ...deployment, readyState })),
      ).toBe(url);
    },
  );

  it.each([
    "",
    "provider-secret-sentinel",
    `${url}\n${url}`,
    `Uploading...\n${url}`,
    `{}\n${url}`,
    "{}",
    "null",
    "[]",
    "{ malformed provider-secret-sentinel",
    JSON.stringify({ status: "ok" }),
    JSON.stringify({
      status: "error",
      deployment,
      message: "provider-secret-sentinel",
    }),
    JSON.stringify({ status: "action_required", deployment }),
    JSON.stringify({ deployment }),
    JSON.stringify({ ...deployment, id: "invalid" }),
    JSON.stringify({ ...deployment, target: "preview" }),
    JSON.stringify({ ...deployment, target: null }),
    JSON.stringify({ ...deployment, readyState: "ERROR" }),
    JSON.stringify({ ...deployment, readyState: "CANCELED" }),
    JSON.stringify({ ...deployment, readyState: "unknown" }),
    JSON.stringify({
      ...deployment,
      error: { message: "provider-secret-sentinel" },
    }),
    JSON.stringify({
      status: "ok",
      deployment,
      error: "provider-secret-sentinel",
    }),
  ])("fails closed and redacts invalid provider output case %#", (output) => {
    expect(() => parseVercelDeployOutput(output)).toThrow(
      "Vercel deployment output was invalid; details were suppressed.",
    );
  });

  it.each([
    "http://industrial-sas.vercel.app",
    "https://app.thaipropertyai.com",
    "https://industrial-sas.vercel.app.evil.invalid",
    "https://vercel.app",
    "https://industrial-sas.vercel.app:8443",
    "https://secret@industrial-sas.vercel.app",
    "https://industrial-sas.vercel.app/?secret=sentinel",
    "https://industrial-sas.vercel.app/#secret-sentinel",
    "https://industrial-sas.vercel.app/private",
    "https://industrial-sas.vercel.app/../",
    "https://industrial-sas.vercel.app\\private",
  ])("refuses unsafe or non-native deployment URLs case %#", (value) => {
    expect(() => parseVercelDeployOutput(value)).toThrow(
      "details were suppressed",
    );
    expect(() =>
      parseVercelDeployOutput(JSON.stringify({ ...deployment, url: value })),
    ).toThrow("details were suppressed");
  });
});
