import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { downloadPinnedBackend } from "../../scripts/ci/check-convex-codegen.mjs";

const fixtures: string[] = [];
const SCRIPT = join(process.cwd(), "scripts/ci/check-convex-codegen.mjs");

// This executable substitutes for pnpm, so even a broken guard can only write
// inside the fixture. No Convex CLI, backend, credential or network is used.
const FAKE_PNPM = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const raw = process.argv.slice(2);
const envFile = raw.find(arg => arg.startsWith("--env-file="))?.slice("--env-file=".length);
const args = ["exec", "convex", ...raw.slice(raw.indexOf("node_modules/convex/bin/main.js") + 1)];
const call = {
  args,
  home: process.env.HOME,
  envFile,
  env: process.env,
  selection: envFile && fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : null,
  envMode: envFile && fs.existsSync(envFile) ? fs.statSync(envFile).mode & 0o777 : null,
};
fs.appendFileSync("calls.jsonl", JSON.stringify(call) + "\\n");
const mode = fs.readFileSync("mode.txt", "utf8");
if (mode === 'interrupted') setTimeout(() => {}, 200);
if (mode === "cli-failure" && args[2] === "env") process.exit(7);
if (args[2] === "codegen") {
  const generated = "convex/_generated";
  if (mode === "changed") fs.writeFileSync(path.join(generated, "api.d.ts"), "changed contract");
  if (mode === "added") fs.writeFileSync(path.join(generated, "new.js"), "new contract");
  if (mode === "deleted") fs.unlinkSync(path.join(generated, "api.d.ts"));
}
`;

const FAKE_BACKEND = `#!${process.execPath}
const fs = require('node:fs');
const http = require('node:http');
const args = process.argv.slice(2);
const name = args[args.indexOf('--instance-name') + 1];
const mode = fs.readFileSync('mode.txt', 'utf8');
if (args[0] === 'keygen') {
  if (mode === 'keygen-failure') process.exit(8);
  process.stdout.write(name + '|synthetic-owned-local-key');
  process.exit(0);
}
fs.writeFileSync('backend.json', JSON.stringify({ pid:process.pid, args, home:process.env.HOME }));
const server = http.createServer((_request,response) => response.end(mode === 'wrong-identity' ? 'wrong-instance' : name));
server.listen(Number(args[args.indexOf('--port') + 1]), '127.0.0.1');
if (mode === 'interrupted') setTimeout(() => process.kill(process.ppid, 'SIGTERM'), 30);
process.on('SIGTERM', () => { if(mode !== 'ignore-stop') server.close(() => process.exit(0)); });
`;

interface Call {
  args: string[];
  home: string;
  envFile: string;
  env: Record<string, string>;
  selection: string | null;
  envMode: number | null;
}

function fixture(mode = "unchanged") {
  const root = mkdtempSync(join(tmpdir(), "ci-codegen-test-"));
  fixtures.push(root);
  mkdirSync(join(root, "scripts/ci"), { recursive: true });
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "temp"));
  mkdirSync(join(root, "parent-home/.convex"), { recursive: true });
  mkdirSync(join(root, "convex/_generated/nested"), { recursive: true });
  cpSync(SCRIPT, join(root, "scripts/ci/check-convex-codegen.mjs"));
  cpSync(join(dirname(SCRIPT), "lib.mjs"), join(root, "scripts/ci/lib.mjs"));
  writeFileSync(join(root, "bin/pnpm"), FAKE_PNPM, { mode: 0o755 });
  writeFileSync(join(root, "bin/fake-backend"), FAKE_BACKEND, { mode: 0o755 });
  // The downloader is the only injected seam. The real orchestrator still
  // generates an owned key, binds/identifies a real local child, passes the
  // explicit private envfile to fake CLI tools, and stops that child.
  writeFileSync(
    join(root, "fixture-runner.mjs"),
    `
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { runCodegenCheck } from './scripts/ci/check-convex-codegen.mjs';
process.exitCode = await runCodegenCheck({ download: async (home) => {
  const binary = join(home, 'convex-local-backend');
  cpSync('bin/fake-backend', binary);
  return binary;
} });
`,
  );
  writeFileSync(join(root, "mode.txt"), mode);
  writeFileSync(join(root, "convex/_generated/api.d.ts"), "original contract");
  writeFileSync(join(root, "convex/_generated/nested/server.js"), "server");
  writeFileSync(join(root, "parent-home/.convex/config.json"), "parent login");
  const run = (overrides: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["fixture-runner.mjs"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        NODE_ENV: "test",
        PATH: `${join(root, "bin")}:${dirname(process.execPath)}`,
        HOME: join(root, "parent-home"),
        TMPDIR: join(root, "temp"),
        ...overrides,
      },
    });
  const calls = (): Call[] =>
    existsSync(join(root, "calls.jsonl"))
      ? readFileSync(join(root, "calls.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Call)
      : [];
  return { root, run, calls };
}

afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("credential-free Convex codegen isolation", () => {
  it.each([
    "CONVEX_DEPLOY_KEY",
    "CONVEX_DEPLOYMENT",
    "CONVEX_ADMIN_KEY",
    "CONVEX_SELF_HOSTED_URL",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
    "CONVEX_OVERRIDE_ACCESS_TOKEN",
    "CONVEX_PROVISION_HOST",
    "CONVEX_AGENT_MODE",
    "CONVEX_FUTURE_SELECTOR",
    "convex_deployment",
  ])("rejects %s before any tool or state creation", (name) => {
    const probe = fixture();
    const result = probe.run({ [name]: "nonfunctional-private-sentinel" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(name);
    expect(result.stderr).not.toContain("nonfunctional-private-sentinel");
    expect(probe.calls()).toEqual([]);
    expect(readdirSync(join(probe.root, "temp"))).toEqual([]);
    expect(existsSync(join(probe.root, ".convex"))).toBe(false);
  });

  it.each([".env", ".env.local", ".env.production", ".env.test"])(
    "refuses and preserves preexisting %s before any side effect",
    (name) => {
      const probe = fixture();
      const file = join(probe.root, name);
      writeFileSync(file, "CONVEX_SELF_HOSTED_ADMIN_KEY=private-sentinel");
      const result = probe.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(name);
      expect(result.stderr).not.toContain("private-sentinel");
      expect(readFileSync(file, "utf8")).toContain("private-sentinel");
      expect(probe.calls()).toEqual([]);
      expect(readdirSync(join(probe.root, "temp"))).toEqual([]);
    },
  );

  it("refuses and preserves existing local deployment data", () => {
    const probe = fixture();
    mkdirSync(join(probe.root, ".convex"));
    writeFileSync(join(probe.root, ".convex/data"), "existing data");
    expect(probe.run().status).toBe(1);
    expect(probe.calls()).toEqual([]);
    expect(readFileSync(join(probe.root, ".convex/data"), "utf8")).toBe(
      "existing data",
    );
    expect(readdirSync(join(probe.root, "temp"))).toEqual([]);
  });

  it("uses an owned anonymous selector for every command and strips inherited secrets/config", () => {
    const probe = fixture();
    writeFileSync(
      join(probe.root, ".env.example"),
      "CONVEX_DEPLOY_KEY=example",
    );
    const result = probe.run({
      OTHER_SECRET: "private-sentinel",
      HTTPS_PROXY: "https://proxy.invalid",
      npm_config_userconfig: "/private/config",
      NODE_OPTIONS: "--no-warnings",
      XDG_CONFIG_HOME: "/private/config",
    });
    expect(result.status, result.stderr).toBe(0);
    const calls = probe.calls();
    expect(calls.map(({ args }) => args[2])).toEqual(["env", "codegen"]);
    for (const call of calls) {
      expect(call.selection).toMatch(
        /^CONVEX_SELF_HOSTED_URL=http:\/\/127\.0\.0\.1:\d+\nCONVEX_SELF_HOSTED_ADMIN_KEY=anonymous-agent-[a-f0-9]+\|synthetic-owned-local-key\n$/,
      );
      expect(call.envMode).toBe(0o600);
      expect(call.home).not.toBe(join(probe.root, "parent-home"));
      expect(call.envFile).toBe(join(call.home, "deployment.env"));
      expect(call.env.CI).toBe("1");
      // macOS adds this system value when launching Node, independently of the
      // environment supplied to spawnSync; it contains no caller configuration.
      expect(
        Object.keys(call.env)
          .filter((name) => name !== "__CF_USER_TEXT_ENCODING")
          .sort(),
      ).toEqual(["CI", "HOME", "PATH"].sort());
      expect(existsSync(call.home)).toBe(false);
    }
    const backend = JSON.parse(
      readFileSync(join(probe.root, "backend.json"), "utf8"),
    ) as { pid: number; args: string[]; home: string };
    expect(backend.args).toContain("--disable-beacon");
    expect(backend.args.slice(0, 2)).toEqual(["--interface", "127.0.0.1"]);
    expect(() => process.kill(backend.pid, 0)).toThrow();
    expect(existsSync(backend.home)).toBe(false);
    expect(existsSync(join(probe.root, ".env.local"))).toBe(false);
    expect(existsSync(join(probe.root, ".convex"))).toBe(false);
    expect(existsSync(join(probe.root, ".env.example"))).toBe(true);
    expect(
      readFileSync(join(probe.root, "parent-home/.convex/config.json"), "utf8"),
    ).toBe("parent login");
  });

  it.each([
    ["changed", "api.d.ts"],
    ["added", "new.js"],
    ["deleted", "api.d.ts"],
  ])(
    "fails on %s generator output and identifies the changed path",
    (mode, name) => {
      const probe = fixture(mode);
      const result = probe.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`convex/_generated/${name}`);
      expect(existsSync(join(probe.root, ".env.local"))).toBe(false);
      expect(existsSync(join(probe.root, ".convex"))).toBe(false);
      expect(readdirSync(join(probe.root, "temp"))).toEqual([]);
      if (mode === "changed")
        expect(
          readFileSync(join(probe.root, "convex/_generated/api.d.ts"), "utf8"),
        ).toBe("changed contract");
    },
  );

  it("fails closed on a tool error and cleans all owned state", () => {
    const probe = fixture("cli-failure");
    const result = probe.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("convex env failed (exit 7)");
    expect(probe.calls().map(({ args }) => args[2])).toEqual(["env"]);
    expect(existsSync(join(probe.root, ".env.local"))).toBe(false);
    expect(existsSync(join(probe.root, ".convex"))).toBe(false);
    expect(readdirSync(join(probe.root, "temp"))).toEqual([]);
  });

  it.each(["wrong-identity", "keygen-failure", "ignore-stop", "interrupted"])(
    "owns and bounds the backend lifecycle on %s",
    { timeout: 15_000 },
    (mode) => {
      const probe = fixture(mode);
      const result = probe.run();
      expect(result.status, result.stderr).toBe(mode === "ignore-stop" ? 0 : 1);
      expect(readdirSync(join(probe.root, "temp"))).toEqual([]);
      if (["wrong-identity", "keygen-failure"].includes(mode))
        expect(probe.calls()).toEqual([]);
      if (existsSync(join(probe.root, "backend.json"))) {
        const { pid } = JSON.parse(
          readFileSync(join(probe.root, "backend.json"), "utf8"),
        ) as { pid: number };
        expect(() => process.kill(pid, 0)).toThrow();
      }
    },
  );

  it("verifies the fixed-release archive before extracting or executing it", async () => {
    const home = mkdtempSync(join(tmpdir(), "ci-codegen-checksum-"));
    fixtures.push(home);
    const urls: string[] = [];
    const fetchArtifact: typeof fetch = async (input) => {
      urls.push(String(input));
      return new Response("untrusted synthetic archive", { status: 200 });
    };
    await expect(
      downloadPinnedBackend(home, {}, fetchArtifact),
    ).rejects.toThrow("CODEGEN_PINNED_BACKEND_CHECKSUM_MISMATCH");
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(
      "/get-convex/convex-backend/releases/download/precompiled-2026-10-06-a3538c6/",
    );
    expect(urls[0]).not.toContain("latest");
    expect(readdirSync(home)).toEqual([]);
  });

  it("fails closed when a generated file cannot be read, before starting a tool", () => {
    const probe = fixture();
    symlinkSync(
      "missing-contract",
      join(probe.root, "convex/_generated/broken.js"),
    );
    expect(probe.run().status).toBe(1);
    expect(probe.calls()).toEqual([]);
    expect(readdirSync(join(probe.root, "temp"))).toEqual([]);
  });
});
