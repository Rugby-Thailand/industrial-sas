import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, closeSync } from "node:fs";
import { once } from "node:events";
import { openHrRunLog } from "./lib/hr-e2e-archive.mjs";

const directory = process.env.HR_E2E_RUN_DIRECTORY;
if (!directory) throw new Error("HR_E2E_RUN_ARCHIVE_REQUIRED");
const output = openHrRunLog(directory, "web.log");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--hostname",
    "localhost",
    "--port",
    "3110",
  ],
  { stdio: ["ignore", output, output], env: process.env },
);
closeSync(output);
appendFileSync(
  `${directory}/processes.jsonl`,
  JSON.stringify({
    at: new Date().toISOString(),
    event: "start",
    label: "next",
    pid: child.pid,
    pgid: Number(
      execFileSync("ps", ["-o", "pgid=", "-p", String(child.pid)], {
        encoding: "utf8",
      }).trim(),
    ),
  }) + "\n",
  { mode: 0o600 },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
const [code] = await once(child, "close");
process.exitCode = code ?? 1;
