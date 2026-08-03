/**
 * Isolation tier — proof that the tenant boundary guard fails on a bypass.
 *
 * The guard passing over `convex/` is a weak claim on its own: a check that
 * answers "no problems" to everything passes just as happily. So every case here
 * builds a throwaway source tree in `os.tmpdir()`, one stub per allowlisted path
 * plus whatever the case is about, and asserts which rules fire. The real
 * `convex/` tree is read once — to prove it is clean — and never written: a
 * demonstration that needs a production file edited is one forgotten revert away
 * from being the committed state.
 *
 * Nothing here proves runtime isolation. This is a static reachability guard over
 * source text: it says a module cannot name the registration builders or the raw
 * database, not that a deployed function scoped its reads.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  TENANT_BOUNDARY_ALLOWLIST,
  collectTenantBoundaryViolations,
} from "../../scripts/verify-tenant-boundary.mjs";

/**
 * The minimum tree the allowlist claims exists. Each stub does the thing its
 * real counterpart is allowed to do, so a passing run is evidence about the
 * allowlist and not about an empty directory.
 */
const ALLOWLISTED_STUBS: Readonly<Record<string, string>> = {
  "convex/lib/tenantDb.ts": `export interface TenantStoragePort {
  readonly get: (table: string, id: string) => Promise<unknown>;
}
`,
  "convex/lib/tenantStorage.ts": `import type { TenantStoragePort } from "./tenantDb";
export function createQueryTenantStorage(ctx: { db: unknown }) {
  return ctx.db as unknown as TenantStoragePort;
}
export function createMutationTenantStorage(ctx: { db: unknown }) {
  return ctx.db as unknown as TenantStoragePort;
}
`,
  "convex/lib/tenantContextLookups.ts": `export function createLookups(ctx: { db: { get: () => unknown } }) {
  const { db } = ctx;
  return { get: () => db.get() };
}
`,
  "convex/lib/tenantFunctions.ts": `import { mutationGeneric, queryGeneric } from "convex/server";
import {
  createMutationTenantStorage,
  createQueryTenantStorage,
} from "./tenantStorage";
export const queryWithOrg = (handler: unknown) =>
  queryGeneric({ handler: () => [handler, createQueryTenantStorage] });
export const mutationWithOrg = (handler: unknown) =>
  mutationGeneric({ handler: () => [handler, createMutationTenantStorage] });
`,
};

/** Scan a synthetic tree; `files` overrides or extends the allowlisted stubs. */
function scanTree(
  files: Readonly<Record<string, string>>,
  options: { readonly omit?: readonly string[] } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "tenant-boundary-"));
  try {
    const tree = { ...ALLOWLISTED_STUBS, ...files };
    for (const path of options.omit ?? []) delete tree[path];
    for (const [path, source] of Object.entries(tree)) {
      const absolute = join(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, source, "utf8");
    }
    return collectTenantBoundaryViolations(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The distinct rules a scan reported, sorted, for a single readable assertion. */
const rulesOf = (files: Readonly<Record<string, string>>): string[] =>
  [...new Set(scanTree(files).map((violation) => violation.rule))].sort();

describe("tenant boundary guard", () => {
  it("passes over the real convex tree", () => {
    expect(collectTenantBoundaryViolations()).toEqual([]);
  });

  it("passes on a feature module that stays inside the boundary", () => {
    expect(
      rulesOf({
        "convex/receiving/receipts.ts": `import type { TenantDocumentAccess } from "../lib/tenantDb";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";

// Prose is not access: this handler never reaches ctx.db, and it must not
// import queryGeneric, mutationGeneric, or createQueryTenantStorage either.
const NOTE = "ctx.db and queryGeneric are named here as strings only";

export const listReceipts = queryWithOrg(
  (tenantDb: TenantDocumentAccess) => [tenantDb, NOTE],
);
export const receive = mutationWithOrg(
  (tenantDb: TenantDocumentAccess) => tenantDb,
);
`,
      }),
    ).toEqual([]);
  });

  it("fails a feature module that registers a public function directly", () => {
    expect(
      rulesOf({
        "convex/receiving/direct.ts": `import { mutation, query } from "./_generated/server";
export const listAll = query({ handler: () => [] });
export const writeAll = mutation({ handler: () => null });
`,
      }),
    ).toEqual(["registration"]);
  });

  it("fails an aliased registration import", () => {
    const violations = scanTree({
      "convex/receiving/aliased.ts": `import { queryGeneric as register } from "convex/server";
export const listAll = register({ handler: () => [] });
`,
    });
    expect(violations.map((violation) => violation.rule)).toContain(
      "registration",
    );
    expect(
      violations.every((v) => v.file === "convex/receiving/aliased.ts"),
    ).toBe(true);
  });

  it("fails namespace and element access to a registration builder", () => {
    expect(
      rulesOf({
        "convex/receiving/namespace.ts": `import * as server from "convex/server";
export const listAll = server.query({ handler: () => [] });
export const writeAll = server["mutation"]({ handler: () => null });
export const runIt = server.actionGeneric({ handler: () => null });
`,
      }),
    ).toEqual(["registration"]);
  });

  it("fails a re-export and a dynamic import of the registry", () => {
    expect(
      rulesOf({
        "convex/receiving/reexport.ts": `export * from "convex/server";
export async function later() {
  return await import("convex/server");
}
`,
      }),
    ).toEqual(["registration"]);
  });

  it("fails raw database access in every syntactic form", () => {
    const violations = scanTree({
      "convex/receiving/raw.ts": `export async function readAll(ctx: {
  db: { query: (t: string) => Promise<unknown[]> };
}) {
  const direct = await ctx.db.query("receipts");
  const indexed = await ctx["db"].query("receipts");
  const { db } = ctx;
  const { db: aliased } = ctx;
  return [direct, indexed, db, aliased];
}
`,
    });
    expect([...new Set(violations.map((v) => v.rule))]).toEqual([
      "raw-database",
    ]);
    // One report per line, and every offending line is named.
    expect(violations.map((violation) => violation.line)).toEqual([4, 5, 6, 7]);
  });

  it("fails a concrete storage adapter import outside the allowlist", () => {
    expect(
      rulesOf({
        "convex/receiving/adapter.ts": `import { createQueryTenantStorage } from "../lib/tenantStorage";
export const storage = createQueryTenantStorage;
`,
      }),
    ).toEqual(["storage-factory"]);
  });

  it("fails a storage port type outside the port and its adapter", () => {
    expect(
      rulesOf({
        "convex/receiving/port.ts": `import type { TenantStoragePort } from "../lib/tenantDb";
export function read(port: TenantStoragePort) {
  return port;
}
`,
      }),
    ).toEqual(["storage-port"]);
    // A locally declared look-alike port is the same bypass with a new name.
    expect(
      rulesOf({
        "convex/receiving/ownPort.ts": `export interface TenantReceiptStoragePort {
  readonly get: () => Promise<unknown>;
}
`,
      }),
    ).toEqual(["storage-port"]);
  });

  it("denies a new wrapper: the allowlist is exact paths, not a pattern", () => {
    expect(
      rulesOf({
        "convex/lib/tenantFunctions2.ts": `import { queryGeneric } from "convex/server";
import { createQueryTenantStorage } from "./tenantStorage";
export const queryWithOrg = () => queryGeneric(createQueryTenantStorage);
`,
        "convex/lib/nested/tenantFunctions.ts": `import { queryGeneric } from "convex/server";
export const queryWithOrg = queryGeneric;
`,
      }),
    ).toEqual(["registration", "storage-factory"]);
  });

  it("reports allowlist drift when an allowlisted file is renamed away", () => {
    const violations = scanTree({}, { omit: ["convex/lib/tenantStorage.ts"] });
    expect(violations).toEqual([
      {
        file: "convex/lib/tenantStorage.ts",
        line: null,
        rule: "allowlist-drift",
        message: "allowlisted path does not exist; update the allowlist",
      },
    ]);
  });

  it("ignores generated code, tests, and fixtures", () => {
    const bypass = `import { queryGeneric } from "convex/server";
export const listAll = queryGeneric({ handler: (ctx: { db: unknown }) => ctx.db });
`;
    expect(
      rulesOf({
        "convex/_generated/server.ts": bypass,
        "convex/receiving/receipts.test.ts": bypass,
        "convex/receiving/receipts.spec.tsx": bypass,
        "convex/fixtures/world.ts": bypass,
        "convex/receiving/types.d.ts": bypass,
      }),
    ).toEqual([]);
  });

  it("keeps every allowlist entry inside convex/lib", () => {
    for (const paths of Object.values(TENANT_BOUNDARY_ALLOWLIST)) {
      for (const path of paths) {
        expect(path).toMatch(/^convex\/lib\/[A-Za-z]+\.ts$/);
      }
    }
  });
});
