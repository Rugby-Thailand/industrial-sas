// Refusal tests for the production operator scripts. Nothing here contacts a
// deployment: in-process tests exercise the local controls only, and every
// subprocess run fails a local guard before a client exists. Subprocesses also
// preload a fetch that throws, so a regression cannot reach the network.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PRODUCTION_OPERATOR_TARGET,
  envFileFromExecArgv,
  prepareOperatorRun,
} from "../../scripts/lib/productionOperator.mjs";

const PROD_URL = PRODUCTION_OPERATOR_TARGET.deploymentUrl;
// Synthetic, correctly shaped values. They are never valid credentials.
const ADMIN = "prod:greedy-cardinal-537|SyntheticAdminSentinel0001";
const DEPLOY = "prod:greedy-cardinal-537|SyntheticDeploySentinel0002";
const SCRIPTS = [
  "scripts/import-pd-production.mjs",
  "scripts/import-fg1-production.mjs",
  "scripts/expand-fg1-r04-r08-production.mjs",
  "scripts/correct-fg1-rear-aisle-production.mjs",
] as const;
const BLOCK_NETWORK = `data:text/javascript,${encodeURIComponent(
  'globalThis.fetch = () => { throw new Error("network blocked by operator test"); };',
)}`;

let root: string;
let repo: string;

const envText = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";

function privateFile(path: string, text: string, mode = 0o600) {
  writeFileSync(path, text, { mode });
  chmodSync(path, mode);
  return path;
}

function privateDirectory(path: string, mode = 0o700) {
  mkdirSync(path, { recursive: true });
  chmodSync(path, mode);
  return path;
}

function backupFile(
  directory: string,
  data: unknown = { deployment: PROD_URL },
) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  const path = privateFile(join(directory, "preflight.json"), text);
  return { path, sha256: createHash("sha256").update(text).digest("hex") };
}

function context(
  overrides: {
    file?: Record<string, string>;
    env?: Record<string, string>;
    argv?: string[];
    execArgv?: string[];
    backupModes?: string[];
  } = {},
) {
  const fileValues = overrides.file ?? {
    CONVEX_URL: PROD_URL,
    CONVEX_ADMIN_KEY: ADMIN,
  };
  const envFile = privateFile(join(root, "operator.env"), envText(fileValues));
  const directory = privateDirectory(join(root, "run"));
  return {
    envFile,
    directory,
    input: {
      argv: overrides.argv ?? ["--directory", directory],
      env: { NODE_ENV: "test" as const, ...(overrides.env ?? fileValues) },
      execArgv: overrides.execArgv ?? [`--env-file=${envFile}`],
      repositoryRoot: repo,
      ...(overrides.backupModes ? { backupModes: overrides.backupModes } : {}),
    },
  };
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    const message = (error as Error).message;
    expect(message).not.toContain("SyntheticAdminSentinel");
    expect(message).not.toContain("SyntheticDeploySentinel");
    return message;
  }
  throw new Error("Expected the operator controls to refuse.");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "operator-controls-"));
  repo = privateDirectory(join(root, "repo"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("operator credential slot and production target", () => {
  it("accepts only an exact production admin key from the private env file", () => {
    const { input, directory } = context();
    const run = prepareOperatorRun(input);
    expect(run).toMatchObject({
      mode: "preflight",
      url: PROD_URL,
      adminKey: ADMIN,
    });
    expect(run.directory).toContain(directory.split("/").at(-1));
    expect(Object.isFrozen(run)).toBe(true);
  });

  it("rejects the deploy-key slot even when CONVEX_ADMIN_KEY is also present", () => {
    for (const where of ["env", "file"] as const) {
      const file = { CONVEX_URL: PROD_URL, CONVEX_ADMIN_KEY: ADMIN };
      const { input } = context({
        file: where === "file" ? { ...file, CONVEX_DEPLOY_KEY: DEPLOY } : file,
        // Node loads env-file values into the environment, so both cases
        // present the slot in `env`; the file case also has it in the file.
        env: { ...file, CONVEX_DEPLOY_KEY: DEPLOY },
      });
      expect(refusal(() => prepareOperatorRun(input))).toMatch(
        /CONVEX_DEPLOY_KEY must be unset/,
      );
    }
    const legacy = context({
      file: { CONVEX_URL: PROD_URL, CONVEX_DEPLOY_KEY: ADMIN },
    });
    expect(refusal(() => prepareOperatorRun(legacy.input))).toMatch(
      /CONVEX_DEPLOY_KEY must be unset/,
    );
  });

  it.each([
    ["another deployment", "prod:other-deployment-123|SyntheticAdminSentinel"],
    ["a development key", "dev:greedy-cardinal-537|SyntheticAdminSentinel"],
    ["a preview key", "preview:trustera:industrial-sas|SyntheticAdminSentinel"],
    ["a project key", "project:trustera:industrial-sas|SyntheticAdminSentinel"],
    ["a malformed value", "SyntheticAdminSentinel"],
    ["an empty secret", "prod:greedy-cardinal-537|"],
  ])("rejects %s in CONVEX_ADMIN_KEY", (_label, key) => {
    const file = { CONVEX_URL: PROD_URL, CONVEX_ADMIN_KEY: key };
    const { input } = context({ file });
    expect(refusal(() => prepareOperatorRun(input))).toMatch(
      /CONVEX_ADMIN_KEY is not a prod deployment credential/,
    );
  });

  it("rejects a wrong PROD_URL, a missing file value, a shell override and developer selectors", () => {
    const wrongUrl = context({
      file: {
        CONVEX_URL: "https://befitting-stoat-208.convex.cloud",
        CONVEX_ADMIN_KEY: ADMIN,
      },
    });
    expect(refusal(() => prepareOperatorRun(wrongUrl.input))).toMatch(
      /CONVEX_URL is not the reviewed production deployment/,
    );
    const shellOnly = context({
      file: { CONVEX_URL: PROD_URL },
      env: { CONVEX_URL: PROD_URL, CONVEX_ADMIN_KEY: ADMIN },
    });
    expect(refusal(() => prepareOperatorRun(shellOnly.input))).toMatch(
      /CONVEX_ADMIN_KEY must be defined in the --env-file/,
    );
    const override = context({
      env: {
        CONVEX_URL: PROD_URL,
        CONVEX_ADMIN_KEY: "prod:greedy-cardinal-537|SyntheticAdminSentinel9",
      },
    });
    expect(refusal(() => prepareOperatorRun(override.input))).toMatch(
      /overrides the --env-file/,
    );
    const developer = context({
      env: {
        CONVEX_URL: PROD_URL,
        CONVEX_ADMIN_KEY: ADMIN,
        CONVEX_DEPLOYMENT: "dev:local",
      },
    });
    expect(refusal(() => prepareOperatorRun(developer.input))).toMatch(
      /CONVEX_DEPLOYMENT must be unset/,
    );
  });
});

describe("operator env file and artifact controls", () => {
  it("refuses repeated controls instead of taking the final value", () => {
    for (const option of [
      "mode",
      "directory",
      "backup",
      "backup-sha256",
      "confirm-deployment",
    ]) {
      const { input } = context({
        argv: [`--${option}=first`, `--${option}`, "second"],
      });
      expect(refusal(() => prepareOperatorRun(input))).toBe(
        `Duplicate operator option --${option}`,
      );
    }
  });
  it("requires exactly one --env-file and refuses --env-file-if-exists", () => {
    expect(refusal(() => envFileFromExecArgv([]))).toMatch(/exactly one/);
    expect(
      refusal(() => envFileFromExecArgv(["--env-file=a", "--env-file", "b"])),
    ).toMatch(/exactly one/);
    expect(
      refusal(() => envFileFromExecArgv(["--env-file-if-exists=a"])),
    ).toMatch(/not --env-file-if-exists/);
    expect(envFileFromExecArgv(["--env-file", "x.env"])).toBe(resolve("x.env"));
  });

  it("refuses readable, linked or repository env files but allows ignored private directories", () => {
    const readable = context();
    chmodSync(readable.envFile, 0o644);
    expect(refusal(() => prepareOperatorRun(readable.input))).toMatch(
      /--env-file must be owner-only/,
    );

    const linked = context();
    const link = join(root, "linked.env");
    symlinkSync(linked.envFile, link);
    expect(
      refusal(() =>
        prepareOperatorRun({
          ...linked.input,
          execArgv: [`--env-file=${link}`],
        }),
      ),
    ).toMatch(/regular file, not a link/);

    const tracked = context();
    const inRepo = privateFile(
      join(privateDirectory(join(repo, "scripts")), "operator.env"),
      envText({ CONVEX_URL: PROD_URL, CONVEX_ADMIN_KEY: ADMIN }),
    );
    expect(
      refusal(() =>
        prepareOperatorRun({
          ...tracked.input,
          execArgv: [`--env-file=${inRepo}`],
        }),
      ),
    ).toMatch(/outside the repository/);

    const ignored = privateFile(
      join(privateDirectory(join(repo, "data", "private")), "operator.env"),
      envText({ CONVEX_URL: PROD_URL, CONVEX_ADMIN_KEY: ADMIN }),
    );
    expect(
      prepareOperatorRun({
        ...tracked.input,
        execArgv: [`--env-file=${ignored}`],
      }).adminKey,
    ).toBe(ADMIN);
  });

  it("requires an existing private 0700 artifact directory outside version control", () => {
    const missing = context({ argv: [] });
    expect(refusal(() => prepareOperatorRun(missing.input))).toMatch(
      /--directory must name an existing private directory/,
    );
    const open = context();
    chmodSync(open.directory, 0o755);
    expect(refusal(() => prepareOperatorRun(open.input))).toMatch(
      /must be mode 0700/,
    );
    const inRepo = privateDirectory(join(repo, "output", "run"));
    const tracked = context();
    expect(
      refusal(() =>
        prepareOperatorRun({ ...tracked.input, argv: ["--directory", inRepo] }),
      ),
    ).toMatch(/Artifact directory must be outside the repository/);
    const link = join(root, "run-link");
    symlinkSync(tracked.directory, link);
    expect(
      refusal(() =>
        prepareOperatorRun({ ...tracked.input, argv: ["--directory", link] }),
      ),
    ).toMatch(/directory, not a link/);
  });

  it("binds backups to a private file and the reviewed SHA-256", () => {
    const base = context();
    const backup = backupFile(base.directory);
    const args = (extra: string[]) => [
      "--mode",
      "verify",
      "--directory",
      base.directory,
      ...extra,
    ];
    expect(
      refusal(() => prepareOperatorRun({ ...base.input, argv: args([]) })),
    ).toMatch(/--backup is required/);
    expect(
      refusal(() =>
        prepareOperatorRun({
          ...base.input,
          argv: args(["--backup", backup.path]),
        }),
      ),
    ).toMatch(/--backup-sha256 must be the 64-character hash/);
    expect(
      refusal(() =>
        prepareOperatorRun({
          ...base.input,
          argv: args([
            "--backup",
            backup.path,
            "--backup-sha256",
            "0".repeat(64),
          ]),
        }),
      ),
    ).toMatch(/does not match --backup-sha256/);

    const verified = prepareOperatorRun({
      ...base.input,
      argv: args(["--backup", backup.path, "--backup-sha256", backup.sha256]),
    });
    expect(verified.backup).toMatchObject({
      sha256: backup.sha256,
      data: { deployment: PROD_URL },
    });

    chmodSync(backup.path, 0o640);
    expect(
      refusal(() =>
        prepareOperatorRun({
          ...base.input,
          argv: args([
            "--backup",
            backup.path,
            "--backup-sha256",
            backup.sha256,
          ]),
        }),
      ),
    ).toMatch(/Backup must be mode 0600/);

    rmSync(backup.path);
    const foreign = backupFile(base.directory, {
      deployment: "https://befitting-stoat-208.convex.cloud",
    });
    expect(
      refusal(() =>
        prepareOperatorRun({
          ...base.input,
          argv: args([
            "--backup",
            foreign.path,
            "--backup-sha256",
            foreign.sha256,
          ]),
        }),
      ),
    ).toMatch(/not captured from the reviewed production deployment/);
  });

  it("keeps preflight read-only by default and requires explicit apply confirmation", () => {
    const base = context();
    const backup = backupFile(base.directory);
    const apply = [
      "--mode",
      "apply",
      "--directory",
      base.directory,
      "--backup",
      backup.path,
      "--backup-sha256",
      backup.sha256,
    ];
    expect(prepareOperatorRun(base.input).mode).toBe("preflight");
    expect(
      refusal(() => prepareOperatorRun({ ...base.input, argv: apply })),
    ).toMatch(/requires --confirm-deployment greedy-cardinal-537/);
    expect(
      refusal(() =>
        prepareOperatorRun({
          ...base.input,
          argv: [...apply, "--confirm-deployment", "befitting-stoat-208"],
        }),
      ),
    ).toMatch(/requires --confirm-deployment/);
    expect(
      prepareOperatorRun({
        ...base.input,
        argv: [...apply, "--confirm-deployment", "greedy-cardinal-537"],
      }).mode,
    ).toBe("apply");
    expect(
      refusal(() =>
        prepareOperatorRun({
          ...base.input,
          argv: [
            "--directory",
            base.directory,
            "--confirm-deployment",
            "greedy-cardinal-537",
          ],
        }),
      ),
    ).toMatch(/only with --mode apply/);
    expect(
      refusal(() =>
        prepareOperatorRun({ ...base.input, argv: ["--mode", "rollback"] }),
      ),
    ).toMatch(/Unknown mode/);
    expect(
      refusal(() =>
        prepareOperatorRun({ ...base.input, argv: ["--retry", "3"] }),
      ),
    ).toMatch(/Unknown or malformed operator argument/);
  });

  it("requires the r1 backup in every rear-aisle correction mode", () => {
    const base = context({ backupModes: ["preflight", "apply", "verify"] });
    expect(refusal(() => prepareOperatorRun(base.input))).toMatch(
      /--backup is required/,
    );
  });
});

describe("production operator scripts refuse before any request", () => {
  function runScript(
    script: string,
    args: string[],
    env: Record<string, string>,
    operatorArgs: string[] = [],
  ) {
    return spawnSync(
      process.execPath,
      [
        "--no-warnings",
        "--import",
        BLOCK_NETWORK,
        ...args,
        script,
        ...operatorArgs,
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        timeout: 30_000,
        // A minimal environment: no inherited Convex selectors or credentials.
        env: {
          PATH: process.env.PATH ?? "",
          HOME: root,
          NODE_ENV: "test",
          ...env,
        },
      },
    );
  }

  it.each(SCRIPTS)(
    "%s refuses an ambiguous repeated mode before creating a client",
    (script) => {
      const result = runScript(script, [], {}, [
        "--mode",
        "preflight",
        "--mode=apply",
      ]);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "Refused: Duplicate operator option --mode",
      );
      expect(result.stderr).not.toContain("network blocked");
    },
  );

  it.each(SCRIPTS)(
    "%s rejects the deploy-key slot alongside an admin key",
    (script) => {
      const envFile = privateFile(
        join(root, "mixed.env"),
        envText({
          CONVEX_URL: PROD_URL,
          CONVEX_ADMIN_KEY: ADMIN,
          CONVEX_DEPLOY_KEY: DEPLOY,
        }),
      );
      const result = runScript(script, [`--env-file=${envFile}`], {});
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "Refused: CONVEX_DEPLOY_KEY must be unset",
      );
      expect(result.stderr).not.toContain("Synthetic");
      expect(result.stderr).not.toContain("network blocked");
    },
  );

  it("refuses a run without --env-file, a legacy deploy-slot file, and a missing directory", () => {
    const script = SCRIPTS[0];
    const none = runScript(script, [], {
      CONVEX_URL: PROD_URL,
      CONVEX_ADMIN_KEY: ADMIN,
    });
    expect(none.status).toBe(1);
    expect(none.stderr).toContain(
      "Refused: Run with exactly one node --env-file",
    );

    const legacy = privateFile(
      join(root, "legacy.env"),
      envText({ CONVEX_URL: PROD_URL, CONVEX_DEPLOY_KEY: ADMIN }),
    );
    const old = runScript(script, [`--env-file=${legacy}`], {});
    expect(old.status).toBe(1);
    expect(old.stderr).toContain("Refused: CONVEX_DEPLOY_KEY must be unset");

    const valid = privateFile(
      join(root, "valid.env"),
      envText({ CONVEX_URL: PROD_URL, CONVEX_ADMIN_KEY: ADMIN }),
    );
    const noDirectory = runScript(script, [`--env-file=${valid}`], {});
    expect(noDirectory.status).toBe(1);
    expect(noDirectory.stdout).toBe("");
    expect(noDirectory.stderr).toContain(
      "Refused: --directory must name an existing private directory",
    );
    for (const result of [none, old, noDirectory]) {
      expect(result.stderr).not.toContain("Synthetic");
      expect(result.stderr).not.toContain("network blocked");
    }
  });
});
