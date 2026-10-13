import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const require = createRequire(import.meta.url);
const tsc = resolve(root, "node_modules/typescript/bin/tsc");

function configuredSkip(flag?: string) {
  const environment = { ...process.env };
  delete environment.CI_EXTERNAL_TYPECHECK;
  if (flag !== undefined) environment.CI_EXTERNAL_TYPECHECK = flag;
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    const load=require('next/dist/server/config').default;
    const {PHASE_PRODUCTION_BUILD}=require('next/constants');
    load(PHASE_PRODUCTION_BUILD, process.cwd()).then(config=>console.log('TYPECHECK_RESULT='+JSON.stringify(config.typescript.ignoreBuildErrors)));
  `,
    ],
    { cwd: root, env: environment, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.match(/TYPECHECK_RESULT=(true|false)/)?.[1] === "true";
}

describe("external CI TypeScript gate", () => {
  it("keeps the actual normalized Next build check unless exact opt-in is set", () => {
    expect(configuredSkip()).toBe(false);
    expect(configuredSkip("true")).toBe(false);
    expect(configuredSkip("1")).toBe(true);
  }, 20_000);

  it("uses the same pinned compiler/config and includes source, tests and generated route types", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    );
    expect(manifest.scripts["typecheck:ts6"]).toBe(
      "next typegen && tsc --noEmit",
    );
    expect(ts.version).toBe(manifest.devDependencies.typescript);
    const parsed = ts.getParsedCommandLineOfConfigFile(
      join(root, "tsconfig.json"),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {
          throw new Error("invalid repository tsconfig");
        },
      },
    );
    expect(parsed).toBeDefined();
    const required: Record<string, unknown> =
      require("next/dist/lib/typescript/writeConfigurationDefaults").getRequiredConfiguration(
        ts,
      );
    expect(
      Object.fromEntries(
        Object.keys(required).map((name) => [
          name,
          parsed?.options[name as keyof ts.CompilerOptions],
        ]),
      ),
    ).toEqual(required);
    expect(parsed?.options.noEmit).toBe(true);
    expect(parsed?.options.skipLibCheck).toBe(true);
    expect(parsed?.options.declarationMap).not.toBe(true);
    expect(parsed?.options.emitDeclarationOnly).not.toBe(true);
    const names =
      parsed?.fileNames.map((name) => name.replaceAll("\\", "/")) ?? [];
    expect(names).toContain(join(root, "src/proxy.ts"));
    expect(names).toContain(
      join(root, "tests/integration/external-typecheck.integration.test.ts"),
    );
    const config = ts.readConfigFile(
      join(root, "tsconfig.json"),
      ts.sys.readFile,
    ).config;
    expect(config.include).toContain(".next/types/**/*.ts");
    expect(config.exclude).not.toContain(".next");
  });

  it("fails the standalone compiler on source and generated route errors before a skipped build can release", () => {
    const directory = mkdtempSync(join(tmpdir(), "external-ts6-gate-"));
    try {
      mkdirSync(join(directory, "src"));
      mkdirSync(join(directory, ".next/types"), { recursive: true });
      writeFileSync(
        join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            types: [],
            skipLibCheck: true,
          },
          include: ["src/**/*.ts", ".next/types/**/*.ts"],
        }),
      );
      const run = () =>
        spawnSync(process.execPath, [tsc, "--noEmit", "--pretty", "false"], {
          cwd: directory,
          encoding: "utf8",
        });
      writeFileSync(
        join(directory, "src/example.ts"),
        "export const count: number = 'bad';\n",
      );
      writeFileSync(
        join(directory, ".next/types/validator.ts"),
        "export const route: number = 1;\n",
      );
      const sourceFailure = run();
      expect(sourceFailure.status).not.toBe(0);
      expect(sourceFailure.stdout).toContain("src/example.ts");
      writeFileSync(
        join(directory, "src/example.ts"),
        "export const count: number = 1;\n",
      );
      writeFileSync(
        join(directory, ".next/types/validator.ts"),
        "export const route: number = 'bad';\n",
      );
      const generatedFailure = run();
      expect(generatedFailure.status).not.toBe(0);
      expect(generatedFailure.stdout).toContain(".next/types/validator.ts");
      writeFileSync(
        join(directory, ".next/types/validator.ts"),
        "export const route: number = 1;\n",
      );
      expect(run().status).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
