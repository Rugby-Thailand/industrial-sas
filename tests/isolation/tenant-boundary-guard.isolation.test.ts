import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  TENANT_BOUNDARY_ALLOWLIST,
  collectTenantBoundaryViolations,
} from "../../scripts/verify-tenant-boundary.mjs";

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
  "convex/lib/identityMirrorConvex.ts": `import { internalMutationGeneric } from "convex/server";
export const apply = internalMutationGeneric({ handler: (ctx: { db: unknown }) => ctx.db });
`,
  "convex/lib/taskFileComplete.ts": `import { internalMutationGeneric } from "convex/server";
export const complete = internalMutationGeneric({ handler: (ctx: { db: unknown }) => ctx.db });
`,
  "convex/lib/transportFileComplete.ts": `import { internalMutationGeneric } from "convex/server";
export const complete = internalMutationGeneric({ handler: (ctx: { db: unknown }) => ctx.db });
`,
  "convex/lib/clerkWebhook.ts": `import { httpActionGeneric } from "convex/server";
export const webhook = httpActionGeneric(async () => new Response(null));
`,
  "convex/lib/authorizationSeedConvex.ts": `export function seed(ctx: { db: unknown }) {
  return ctx.db;
}
`,
  "convex/lib/demoDataSeed.ts": `import { internalMutationGeneric } from "convex/server";
export const seed = internalMutationGeneric({ handler: (ctx: { db: unknown }) => ctx.db });
`,
  "convex/lib/authorizationLookupsConvex.ts": `export function createLookups(ctx: { db: { query: () => unknown } }) {
  return () => ctx.db.query();
}
`,
  "convex/lib/inventoryLedgerStore.ts": `export {};
`,
  "convex/engineering/files.ts": `export {};
`,
  "convex/lib/privateFileDownload.ts": `export {};
`,
  "convex/lib/privateFileUpload.ts": `export {};
`,
  "convex/lib/uploadThingComplete.ts": `import { httpActionGeneric } from "convex/server";
export const complete = httpActionGeneric(async () => new Response(null));
`,
};

const PERMISSION_CATALOGUE_STUB = {
  "convex/lib/permissions.ts": `const permission = (code: string, scope: string) => ({ code, scope });
export const PERMISSION_CATALOGUE = [
  permission("receiving.receipt.post", "WAREHOUSE"),
  permission("admin.audit.read", "ORG"),
  permission("platform.tenant.read", "PLATFORM"),
];
`,
};

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

const rulesOf = (files: Readonly<Record<string, string>>): string[] =>
  [...new Set(scanTree(files).map((violation) => violation.rule))].sort();

describe("tenant boundary guard", () => {
  it("passes over the real convex tree", () => {
    expect(collectTenantBoundaryViolations()).toEqual([]);
  });

  it("passes on a feature module that stays inside the boundary", () => {
    expect(
      rulesOf({
        ...PERMISSION_CATALOGUE_STUB,
        "convex/receiving/receipts.ts": `import type { TenantDocumentAccess } from "../lib/tenantDb";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";

// Prose is not access: this handler never reaches ctx.db, and it must not
// import queryGeneric, mutationGeneric, or createQueryTenantStorage either.
const NOTE = "ctx.db and queryGeneric are named here as strings only";

export const listReceipts = queryWithOrg({
  permissionCode: "receiving.receipt.post",
  target: { table: "warehouses" },
  handler: (ctx: { tenantDb: TenantDocumentAccess }) => [ctx.tenantDb, NOTE],
});
export const receive = mutationWithOrg({
  permissionCode: "receiving.receipt.post",
  target: { table: "warehouses" },
  handler: (ctx: { tenantDb: TenantDocumentAccess }) => ctx.tenantDb,
});
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

  it("fails direct internal and HTTP registrations outside their exact adapters", () => {
    expect(
      rulesOf({
        "convex/receiving/internal.ts": `import { internalMutationGeneric } from "convex/server";
export const write = internalMutationGeneric({ handler: () => null });
`,
        "convex/receiving/webhook.ts": `import { httpAction } from "./_generated/server";
export const route = httpAction(async () => new Response(null));
`,
      }),
    ).toEqual(["http-registration", "internal-registration"]);
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
    ).toEqual(["http-registration", "internal-registration", "registration"]);
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

  it("fails a wrapper call whose permission cannot be enforced", () => {
    const cases: Readonly<Record<string, string>> = {
      "convex/receiving/undeclared.ts": `import { mutationWithOrg } from "../lib/tenantFunctions";
export const post = mutationWithOrg({
  target: { table: "warehouses" },
  handler: () => null,
});
`,
      "convex/receiving/unknown.ts": `import { queryWithOrg } from "../lib/tenantFunctions";
export const read = queryWithOrg({
  permissionCode: "invented.permission.use",
  target: { table: "warehouses" },
  handler: () => null,
});
`,
      "convex/receiving/platform.ts": `import { queryWithOrg } from "../lib/tenantFunctions";
export const read = queryWithOrg({
  permissionCode: "platform.tenant.read",
  target: { table: "warehouses" },
  handler: () => null,
});
`,
      "convex/receiving/computed.ts": `import { actionWithOrg } from "../lib/tenantFunctions";
const CODE = "receiving.receipt.post";
export const run = actionWithOrg({
  permissionCode: CODE,
  target: { table: "warehouses" },
  handler: () => null,
});
`,
      "convex/receiving/spread.ts": `import { queryWithOrg } from "../lib/tenantFunctions";
const definition = { permissionCode: "receiving.receipt.post" };
export const read = queryWithOrg(definition);
`,
      "convex/receiving/aliasedWrapper.ts": `import { mutationWithOrg as register } from "../lib/tenantFunctions";
export const write = register({
  target: { table: "warehouses" },
  handler: () => null,
});
`,
    };

    for (const [path, source] of Object.entries(cases)) {
      const violations = scanTree({
        ...PERMISSION_CATALOGUE_STUB,
        [path]: source,
      });
      expect(
        violations.filter((violation) => violation.file === path),
        `expected ${path} to be reported`,
      ).not.toEqual([]);
      expect([
        ...new Set(violations.map((violation) => violation.rule)),
      ]).toEqual(["authorization-declaration"]);
    }
  });

  it("fails closed when the permission catalogue cannot be read", () => {
    // No `convex/lib/permissions.ts` in the tree: a guard that cannot see the
    // catalogue must not approve a code it cannot check.
    expect(
      rulesOf({
        "convex/receiving/receipts.ts": `import { queryWithOrg } from "../lib/tenantFunctions";
export const read = queryWithOrg({
  permissionCode: "receiving.receipt.post",
  target: { table: "warehouses" },
  handler: () => null,
});
`,
      }),
    ).toEqual(["authorization-declaration"]);
  });

  it("fails any rewrite of an append-only audit table, and permits appends", () => {
    const violations = scanTree({
      ...PERMISSION_CATALOGUE_STUB,
      "convex/receiving/audit.ts": `export async function rewrite(store: {
  patch: (t: string, id: string, f: unknown) => Promise<void>;
  replace: (t: string, id: string, d: unknown) => Promise<void>;
  delete: (t: string, id: string) => Promise<void>;
  insert: (t: string, d: unknown) => Promise<string>;
}) {
  await store.patch("auditEvents", "id", {});
  await store.replace("auditEvents", "id", {});
  await store.delete("auditEvents", "id");
  await store.delete("warehouses", "id");
  return await store.insert("auditEvents", {});
}
`,
    });

    expect([...new Set(violations.map((violation) => violation.rule))]).toEqual(
      ["audit-append-only"],
    );

    expect(violations.map((violation) => violation.line)).toEqual([7, 8, 9]);
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

  it("fails a pure domain module that imports anything outside convex/model", () => {
    expect(
      rulesOf({
        "convex/model/uom/quantity.ts": `import { v } from "convex/values";
export const quantity = v;
`,
      }),
    ).toEqual(["model-purity"]);
    expect(
      rulesOf({
        "convex/model/uom/quantity.ts": `import { PERMISSION_CATALOGUE } from "../../lib/permissions";
export const codes = PERMISSION_CATALOGUE;
`,
      }),
    ).toEqual(["model-purity"]);
    expect(
      rulesOf({
        "convex/model/ledger/post.ts": `export type { Doc } from "../../_generated/dataModel";
`,
      }),
    ).toEqual(["model-purity"]);
    expect(
      rulesOf({
        "convex/model/gs1/parse.ts": `import { z } from "zod";
export const schema = z;
`,
      }),
    ).toEqual(["model-purity"]);
    expect(
      rulesOf({
        "convex/model/gs1/parse.ts": `export const load = async () => import("convex/server");
`,
      }).includes("model-purity"),
    ).toBe(true);
  });

  it("fails a pure domain module whose module specifier it cannot read", () => {
    // A specifier the guard cannot resolve is one it cannot clear: a template
    // literal or a variable can name `convex/server` at run time, and the
    // literal-only check answered "no violation" for every one of these.
    const unreadable = [
      "export const load = async (name: string) => import(name);\n",
      'const target = "convex/server";\nexport const load = async () => import(target);\n',
      'export const load = async () => import(`convex/${"server"}`);\n',
    ];
    for (const source of unreadable) {
      expect(rulesOf({ "convex/model/gs1/parse.ts": source })).toEqual([
        "model-purity",
      ]);
    }
  });

  it("fails a pure domain module that reaches for CommonJS", () => {
    expect(
      rulesOf({
        "convex/model/gs1/parse.ts": `export const server = require("convex/server");
`,
      }),
    ).toEqual(["model-purity"]);
    expect(
      rulesOf({
        "convex/model/gs1/parse.ts": `export const server = require(process.env["M"] ?? "");
`,
      }),
    ).toEqual(["model-purity"]);
    expect(
      rulesOf({
        "convex/model/gs1/parse.ts": `import server = require("convex/server");
export const s = server;
`,
      }),
    ).toEqual(["model-purity"]);
  });

  it("still permits a relative dynamic import that stays inside the model", () => {
    expect(
      rulesOf({
        "convex/model/uom/ratio.ts": `export const one = 1;
`,
        "convex/model/gs1/parse.ts": `export const load = async () => import("../uom/ratio");
`,
      }),
    ).toEqual([]);
  });

  it("permits a pure domain module that only imports its own siblings", () => {
    expect(
      rulesOf({
        "convex/model/result.ts": `export type Result<T> = { readonly value: T };
`,
        "convex/model/uom/quantity.ts": `import type { Result } from "../result";
export const one = (): Result<number> => ({ value: 1 });
`,
        "convex/model/uom/ratio.ts": `import { one } from "./quantity";
export const two = () => one();
`,
      }),
    ).toEqual([]);
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

  it("keeps allowlist entries inside convex/lib except the reviewed grant redeemer", () => {
    // The empty-allowlist rules (`authorization-declaration`,
    // `audit-append-only`, `model-purity`) contribute nothing to this loop, which
    // is the point: they have no exemptions to keep anywhere.
    const outsideLibrary: string[] = [];
    for (const paths of Object.values(TENANT_BOUNDARY_ALLOWLIST)) {
      for (const path of paths) {
        if (!/^convex\/lib\/[A-Za-z]+\.ts$/.test(path)) {
          outsideLibrary.push(path);
        }
      }
    }
    expect([...new Set(outsideLibrary)]).toEqual([
      "convex/engineering/files.ts",
    ]);
    expect(TENANT_BOUNDARY_ALLOWLIST["model-purity"]).toEqual([]);
  });
});
