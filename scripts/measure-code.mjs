import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const BASELINE = { production: 52_551, test: 43_745 };
const roots = ["src", "convex", "tests"];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    }),
  );
  return files.flat();
}

const generated = (path) =>
  path.startsWith("convex/_generated/") || path.endsWith(".d.ts");
const test = (path) =>
  path.startsWith("tests/") || /\.(?:a11y\.)?test\.[^.]+$/.test(path);

function count(listFile) {
  const run = spawnSync(
    "pnpm",
    ["dlx", "cloc@2.06", "--json", "--quiet", `--list-file=${listFile}`],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(run.stderr || run.stdout);
  return JSON.parse(run.stdout).SUM.code;
}

const temporary = await mkdtemp(join(tmpdir(), "industrial-sas-loc-"));
try {
  const files = (await Promise.all(roots.map(filesUnder)))
    .flat()
    .map((path) => relative(process.cwd(), path));
  const groups = { production: [], test: [], generated: [] };
  for (const path of files) {
    groups[
      generated(path) ? "generated" : test(path) ? "test" : "production"
    ].push(path);
  }

  const results = {};
  for (const [name, paths] of Object.entries(groups)) {
    const listFile = join(temporary, name);
    await writeFile(listFile, `${paths.join("\n")}\n`);
    results[name] = count(listFile);
  }

  console.table(
    ["production", "test"].map((scope) => {
      const removed = BASELINE[scope] - results[scope];
      return {
        scope,
        baseline: BASELINE[scope],
        current: results[scope],
        removed,
        reduction: `${((removed / BASELINE[scope]) * 100).toFixed(2)}%`,
        "remaining to 50%": Math.max(
          0,
          results[scope] - Math.floor(BASELINE[scope] / 2),
        ),
      };
    }),
  );
  console.log(`Generated SLOC excluded from the target: ${results.generated}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
