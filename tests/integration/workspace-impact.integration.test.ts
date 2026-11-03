import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  renameSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  classify,
  dependencyEvidence,
  diffEvidence,
  harnesses,
  imports,
  report,
  runtimeModules,
} from "../../scripts/ci/workspace-impact.mjs";

const root = resolve(import.meta.dirname, "../..");
const evidence = await dependencyEvidence(root);
const prediction = (path: string, status = "M", graph = evidence) =>
  classify({
    event: "pull_request",
    valid: true,
    changes: [{ status, path }],
    evidence: graph,
  });

describe("advisory workspace impact", () => {
  it("records all three real dev resolvers, aliases, shared and runtime dependencies", () => {
    for (const harness of harnesses) {
      expect(evidence.dependencies).toContain(
        `scripts/${harness}/vite.config.mjs`,
      );
      expect(
        evidence.resolutions.some(
          (row: { harness: string }) => row.harness === harness,
        ),
      ).toBe(true);
      expect(
        prediction(`scripts/${harness}/vite.config.mjs`)
          .predictedWorkspaceAffected,
      ).toBe(true);
    }
    expect(
      evidence.resolutions.some(
        (row: { specifier: string; path: string }) =>
          row.specifier === "next/image" &&
          row.path === "scripts/barcode-preview/adapters.tsx",
      ),
    ).toBe(true);
    for (const path of [
      "convex/model/hr/calendar.ts",
      ...Object.values(runtimeModules),
    ]) {
      expect(evidence.dependencies).toContain(path);
      expect(prediction(path).predictedWorkspaceAffected).toBe(true);
    }
    for (const path of [
      "tests/fixtures/barcode-photos/location-3-11.png",
      "public/barcode/zxing_reader.wasm",
      "messages/th.json",
      "playwright.workspace.config.ts",
      "tests/e2e/support/policy.ts",
      "docs/contracts/back-navigation.json",
      "pnpm-lock.yaml",
      "scripts/ci/workspace-impact.mjs",
    ])
      expect(prediction(path).predictedWorkspaceAffected).toBe(true);
  });
  it("audits known computed runtime imports and rejects unknown expressions or changed mappings", () => {
    const file = "tests/e2e/workspace/job-ticket-image-compression.spec.ts";
    const source = readFileSync(join(root, file), "utf8");
    expect(imports(source, file).unknown).toEqual([]);
    expect(imports(source, file).literals).toContain(
      `/${runtimeModules.prepare}`,
    );
    expect(
      imports(source.replace(runtimeModules.prepare, "src/unknown.ts"), file)
        .unknown.length,
    ).toBeGreaterThan(0);
    expect(imports("import(modules.unknown)", file).unknown).toHaveLength(1);
    expect(imports("import(variable)", "src/unknown.ts").unknown).toHaveLength(
      1,
    );
    expect(
      prediction("tests/integration/ci-guards.integration.test.ts", "M", {
        ...evidence,
        unknown: ["unknown import"],
      }).predictedWorkspaceAffected,
    ).toBe(true);
  });
  it("allows only a narrow observed negative, always executing workspace", () => {
    expect(evidence.unknown).toEqual([]);
    const complete = evidence;
    const result = prediction(
      "tests/integration/ci-guards.integration.test.ts",
      "M",
      complete,
    );
    expect(result.predictedWorkspaceAffected).toBe(false);
    expect(result.effectiveWorkspaceRun).toBe(true);
    for (const status of ["A", "D", "R100", "?"])
      expect(
        prediction(
          "tests/integration/ci-guards.integration.test.ts",
          status,
          complete,
        ).predictedWorkspaceAffected,
      ).toBe(true);
    for (const path of [
      "docs/reviews/new.md",
      "README.md",
      "src/new.ts",
      "unknown.file",
    ])
      expect(prediction(path, "M", complete).predictedWorkspaceAffected).toBe(
        true,
      );
    for (const event of ["push", "workflow_dispatch", "unknown", undefined])
      expect(
        classify({ event, evidence: complete }).predictedWorkspaceAffected,
      ).toBe(true);
    expect(
      classify({ event: "pull_request", valid: false, evidence: complete })
        .predictedWorkspaceAffected,
    ).toBe(true);
    expect(
      classify({ event: "pull_request", valid: true })
        .predictedWorkspaceAffected,
    ).toBe(true);
  });
  it("reports full for absent/invalid history without interpolating shell strings", async () => {
    const eventPath = join(tmpdir(), `workspace-event-${process.pid}.json`);
    try {
      writeFileSync(
        eventPath,
        JSON.stringify({ pull_request: { base: { sha: "$(touch unsafe)" } } }),
      );
      const result = await report(root, {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
      });
      expect(result.predictedWorkspaceAffected).toBe(true);
      expect(result.effectiveWorkspaceRun).toBe(true);
      expect(result.error).toBe("invalid PR base");
      expect((await report(root, {})).predictedWorkspaceAffected).toBe(true);
    } finally {
      rmSync(eventPath, { force: true });
    }
  });
});

const fixture = mkdtempSync(join(tmpdir(), "workspace-impact-git-"));
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: fixture, encoding: "utf8" }).trim();
afterAll(() => rmSync(fixture, { recursive: true, force: true }));
it("reads complete NUL diffs including rename as delete/add, deletion and unusual filenames", () => {
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(fixture, "old.ts"), "original");
  writeFileSync(join(fixture, "deleted.ts"), "deleted");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  renameSync(join(fixture, "old.ts"), join(fixture, "new\nname.ts"));
  rmSync(join(fixture, "deleted.ts"));
  writeFileSync(join(fixture, "--strange.ts"), "added");
  git("add", "-A");
  git("commit", "-qm", "head");
  const head = git("rev-parse", "HEAD");
  const changes = diffEvidence(fixture, base, head);
  expect(changes).toEqual(
    expect.arrayContaining([
      { status: "D", path: "old.ts" },
      { status: "A", path: "new\nname.ts" },
      { status: "D", path: "deleted.ts" },
      { status: "A", path: "--strange.ts" },
    ]),
  );
  expect(() => diffEvidence(fixture, "0".repeat(40), head)).toThrow();
  expect(() => diffEvidence(fixture, "--output=unsafe", head)).toThrow();
});
