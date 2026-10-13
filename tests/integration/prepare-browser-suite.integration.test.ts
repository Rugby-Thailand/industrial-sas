import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function eventually<T>(
  operation: () => Promise<T>,
  predicate: (value: T) => boolean,
): Promise<T> {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const value = await operation();
      if (predicate(value)) return value;
    } catch {
      /* Fixture not ready yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Browser preparation fixture timed out");
}
async function fixture(suite = "smoke", fail = "", descendants = false) {
  const directory = await mkdtemp(join(tmpdir(), "quality-browser-prepare-"));
  directories.push(directory);
  const pnpm = join(directory, "pnpm");
  await writeFile(
    pnpm,
    `#!/usr/bin/env node
const fs=require('node:fs'),{spawn}=require('node:child_process');
const directory=${JSON.stringify(directory)};
const role=process.argv[2]==='exec'?'install':'build';
const descendant=${descendants ? "spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})" : "null"};
fs.writeFileSync(directory+'/'+role+'.started',JSON.stringify({pid:process.pid,descendant:descendant?.pid,args:process.argv.slice(2),flag:process.env.CI_EXTERNAL_TYPECHECK,secret:process.env.SECRET_SENTINEL,preload:process.env.NODE_OPTIONS}));
setInterval(()=>{if(fs.existsSync(directory+'/'+role+'.go')) process.exit(role===${JSON.stringify(fail)}?1:0)},20);
`,
  );
  await chmod(pnpm, 0o755);
  const child = spawn(
    process.execPath,
    [resolve("scripts/ci/prepare-browser-suite.mjs"), `--suite=${suite}`],
    {
      env: {
        PATH: `${directory}:${process.env.PATH}`,
        HOME: process.env.HOME,
        NODE_ENV: "test",
        CI_EXTERNAL_TYPECHECK: "ambient",
        SECRET_SENTINEL: "do-not-inherit",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(child);
  let stderr = "";
  child.stderr?.on("data", (data) => {
    stderr += data;
  });
  const closed = new Promise<number | null>((resolve) =>
    child.once("close", resolve),
  );
  const started = async (role: string) =>
    eventually(
      async () =>
        JSON.parse(await readFile(join(directory, `${role}.started`), "utf8")),
      (value) => typeof value.pid === "number",
    );
  const complete = (role: string) =>
    writeFile(join(directory, `${role}.go`), "go");
  return { child, closed, started, complete, stderr: () => stderr };
}

describe.skipIf(process.platform === "win32")(
  "quality parallel browser preparation",
  () => {
    it("rejects bare, unknown and duplicate CLI suite arguments before starting work", () => {
      for (const args of [
        ["smoke"],
        ["--suite=other"],
        ["--suite=smoke", "--suite=navigation"],
      ]) {
        const result = spawnSync(
          process.execPath,
          [resolve("scripts/ci/prepare-browser-suite.mjs"), ...args],
          { encoding: "utf8" },
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Usage:");
      }
    });

    it("starts both operations together and joins both before success with exact anonymous smoke inputs", async () => {
      const world = await fixture();
      const [build, install] = await Promise.all([
        world.started("build"),
        world.started("install"),
      ]);
      expect(build.args).toEqual(["build"]);
      expect(build.flag).toBe("1");
      expect(install.args).toEqual([
        "exec",
        "playwright",
        "install",
        "--with-deps",
        "--only-shell",
        "chromium",
      ]);
      expect(install.flag).toBeUndefined();
      for (const value of [build, install]) {
        expect(value.secret).toBeUndefined();
        expect(value.preload).toBeUndefined();
      }
      await world.complete("build");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(world.child.exitCode).toBeNull();
      await world.complete("install");
      expect(await world.closed, world.stderr()).toBe(0);
    });

    it("keeps navigation build checking and installs all three browser engines", async () => {
      const world = await fixture("navigation");
      const [build, install] = await Promise.all([
        world.started("build"),
        world.started("install"),
      ]);
      expect(build.args).toEqual(["build:navigation"]);
      expect(build.flag).toBeUndefined();
      expect(install.args).toEqual([
        "exec",
        "playwright",
        "install",
        "--with-deps",
        "--only-shell",
        "chromium",
        "firefox",
        "webkit",
      ]);
      await Promise.all([world.complete("build"), world.complete("install")]);
      expect(await world.closed, world.stderr()).toBe(0);
    });

    it.each(["build", "install"])(
      "fails closed when %s fails while still joining the other operation",
      async (fail) => {
        const world = await fixture("smoke", fail);
        await Promise.all([world.started("build"), world.started("install")]);
        await world.complete(fail);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(world.child.exitCode).toBeNull();
        await world.complete(fail === "build" ? "install" : "build");
        expect(await world.closed, world.stderr()).toBe(1);
      },
    );

    it("native cancellation synchronously kills only owned children and descendants and cannot report success", async () => {
      const world = await fixture("smoke", "", true);
      const started = await Promise.all([
        world.started("build"),
        world.started("install"),
      ]);
      world.child.kill("SIGTERM");
      expect(await world.closed, world.stderr()).toBe(143);
      for (const processInfo of started) {
        await eventually(
          async () => {
            try {
              process.kill(-processInfo.pid, 0);
              return false;
            } catch {
              return true;
            }
          },
          (value) => value,
        );
        expect(() => process.kill(processInfo.descendant, 0)).toThrow();
      }
    });
  },
);
