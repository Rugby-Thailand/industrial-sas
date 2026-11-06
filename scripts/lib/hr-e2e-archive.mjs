import { mkdirSync, mkdtempSync, openSync } from "node:fs";
import { resolve, join } from "node:path";

/** Every service lifetime gets a new private directory; no old log is reopened. */
export function createHrRunArchive(root = ".cache/hr-browser/runs") {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(resolve(root), `${Date.now()}-`));
}

export function openHrRunLog(directory, name) {
  if (!/^[a-z-]+\.log$/.test(name)) throw new Error("HR_E2E_LOG_NAME_REFUSED");
  return openSync(join(directory, name), "wx", 0o600);
}
