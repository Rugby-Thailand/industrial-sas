import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = path.resolve("scripts/vercel-ignore-build.mjs");
let repo: string;
let previous: string;

function git(...args: string[]) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function commit(file: string, content = "changed") {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), content);
  git("add", ".");
  git("commit", "-qm", "fixture");
}

function run(base = previous, force = "") {
  return spawnSync(process.execPath, [script], {
    cwd: repo,
    env: {
      ...process.env,
      VERCEL_GIT_PREVIOUS_SHA: base,
      FORCE_VERCEL_BUILD: force,
    },
  }).status;
}

describe("Vercel ignored build step", () => {
  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "planner-deploy-"));
    git("init", "-q");
    git("config", "user.email", "ci@example.invalid");
    git("config", "user.name", "CI fixture");
    git("config", "commit.gpgsign", "false");
    commit("src/app.ts", "original");
    previous = git("rev-parse", "HEAD");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it.each([
    "README.md",
    "AGENTS.md",
    "docs/guide.md",
    ".github/workflows/quality.yml",
  ])("skips a deployment changing only %s", (file) => {
    commit(file);
    expect(run()).toBe(0);
  });

  it.each([
    "src/app.ts",
    "convex/schema.ts",
    "pnpm-lock.yaml",
    "vercel.json",
    "public/help.md",
    "scripts/vercel-ignore-build.mjs",
  ])("builds when %s changes", (file) => {
    commit(file);
    expect(run()).toBe(1);
  });

  it("includes application changes preceding the latest docs commit", () => {
    commit("src/app.ts");
    commit("docs/guide.md");
    expect(run()).toBe(1);
  });

  it("builds when application code is moved into docs", () => {
    mkdirSync(path.join(repo, "docs"));
    git("mv", "src/app.ts", "docs/app.ts");
    git("commit", "-qm", "move");
    expect(run()).toBe(1);
  });

  it.each(["", "invalid", "0".repeat(40)])(
    "builds with missing or unavailable history: %s",
    (base) => {
      commit("README.md");
      expect(run(base)).toBe(1);
    },
  );

  it("builds a redeployment of the same commit", () => {
    expect(run()).toBe(1);
  });

  it("honors the explicit build override", () => {
    commit("README.md");
    expect(run(previous, "1")).toBe(1);
  });
});
