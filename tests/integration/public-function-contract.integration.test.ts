import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  accepts,
  breakingChanges,
  snapshotOf,
  type ContractSnapshot,
  type ExportedValidator,
} from "../fixtures/public-contract";

/**
 * Old-client compatibility for every registered Convex function (BD-02).
 *
 * The production backend is pushed before the new frontend is promoted, and
 * tabs that loaded the previous frontend keep calling it. This suite compares
 * the exported argument/result validators with a reviewed snapshot.
 *
 * Refresh after reviewing an intentional change:
 *   UPDATE_PUBLIC_CONTRACT=1 pnpm exec vitest run --project integration \
 *     tests/integration/public-function-contract.integration.test.ts
 * The refresh refuses to record a breaking public change unless
 * ACCEPT_BREAKING_PUBLIC_CONTRACT names the expand/migrate/contract plan
 * (docs/operations/backend-compatibility.md) that removed the old callers.
 */

const SNAPSHOT_PATH = join(
  process.cwd(),
  "tests/fixtures/public-function-contract.json",
);

const loaded = import.meta.glob(
  [
    "../../convex/**/*.ts",
    "!../../convex/_generated/**",
    "!../../convex/model/**",
    "!../../convex/**/*.test.ts",
    "!../../convex/schema.ts",
    "!../../convex/auth.config.ts",
  ],
  { eager: true },
) as Record<string, Record<string, unknown>>;

const modules = Object.fromEntries(
  Object.entries(loaded).map(([path, exports]) => [
    path.replace("../../convex/", "").replace(/\.ts$/, ""),
    exports,
  ]),
);

const current = snapshotOf(modules);

function readSnapshot(): ContractSnapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as ContractSnapshot;
}

if (process.env.UPDATE_PUBLIC_CONTRACT === "1") {
  const problems = breakingChanges(readSnapshot(), current);
  if (
    problems.length > 0 &&
    !process.env.ACCEPT_BREAKING_PUBLIC_CONTRACT?.trim()
  ) {
    throw new Error(
      `Refusing to record breaking public changes:\n${problems.join("\n")}`,
    );
  }
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(current, null, 2)}\n`);
}

describe("registered Convex function contract", () => {
  it("finds the public surface it is meant to protect", () => {
    const publicNames = Object.entries(current)
      .filter(([, contract]) => contract.visibility === "public")
      .map(([name]) => name);
    expect(publicNames.length).toBeGreaterThan(40);
    expect(publicNames).toContain("workspace/current:readCurrent");
    expect(publicNames).toContain("finishedGoods/workflow:completeMove");
    // The webhook mirror stays internal: only the signed HTTP action calls it.
    expect(
      current["lib/identityMirrorConvex:applyClerkIdentityEvent"],
    ).toMatchObject({
      visibility: "internal",
      kind: "mutation",
    });
  });

  it("keeps every public function compatible with clients built from the snapshot", () => {
    expect(breakingChanges(readSnapshot(), current)).toEqual([]);
  });

  it("has a reviewed snapshot that matches the current registered validators", () => {
    // Additive changes are compatible but still need a reviewed refresh so the
    // next change is compared against what actually shipped.
    expect(current).toEqual(readSnapshot());
  });

  it("declares explicit argument validators on every public function", () => {
    const untyped = Object.entries(current)
      .filter(
        ([, contract]) =>
          contract.visibility === "public" && contract.args.type === "any",
      )
      .map(([name]) => name);
    expect(untyped).toEqual([]);
  });
});

describe("compatibility rules", () => {
  const object = (
    fields: Record<string, [ExportedValidator, boolean?]>,
  ): ExportedValidator => ({
    type: "object",
    value: Object.fromEntries(
      Object.entries(fields).map(([name, [fieldType, optional]]) => [
        name,
        { fieldType, optional: optional ?? false },
      ]),
    ),
  });
  const string: ExportedValidator = { type: "string" };
  const number: ExportedValidator = { type: "number" };
  const contract = (args: ExportedValidator, returns: ExportedValidator) => ({
    "m:f": {
      kind: "query" as const,
      visibility: "public" as const,
      args,
      returns,
    },
  });

  it("allows a new optional argument and a new result field", () => {
    const before = contract(object({ a: [string] }), object({ x: [number] }));
    const after = contract(
      object({ a: [string], b: [number, true] }),
      object({ x: [number], y: [string] }),
    );
    expect(breakingChanges(before, after)).toEqual([]);
  });

  it("flags removed functions, required or removed arguments and narrowed types", () => {
    const before = contract(object({ a: [string] }), object({ x: [number] }));
    expect(breakingChanges(before, {})).toEqual([
      "m:f: public function removed",
    ]);
    expect(
      breakingChanges(
        before,
        contract(object({ a: [string], b: [number] }), object({ x: [number] })),
      ),
    ).toHaveLength(1);
    expect(
      breakingChanges(before, contract(object({}), object({ x: [number] }))),
    ).toHaveLength(1);
    expect(
      breakingChanges(
        before,
        contract(
          object({ a: [{ type: "literal", value: "A" }] }),
          object({ x: [number] }),
        ),
      ),
    ).toHaveLength(1);
  });

  it("flags a removed, newly optional or widened result field", () => {
    const before = contract(object({}), object({ x: [number] }));
    expect(
      breakingChanges(before, contract(object({}), object({}))),
    ).toHaveLength(1);
    expect(
      breakingChanges(
        before,
        contract(object({}), object({ x: [number, true] })),
      ),
    ).toHaveLength(1);
    expect(
      breakingChanges(
        before,
        contract(
          object({}),
          object({ x: [{ type: "union", value: [number, string] }] }),
        ),
      ),
    ).toHaveLength(1);
  });

  it("treats unions member-wise and accepts literals under their primitive", () => {
    const union: ExportedValidator = { type: "union", value: [string, number] };
    expect(accepts(union, string, { extraFieldsAllowed: false })).toBe(true);
    expect(accepts(string, union, { extraFieldsAllowed: false })).toBe(false);
    expect(
      accepts(
        string,
        { type: "literal", value: "A" },
        { extraFieldsAllowed: false },
      ),
    ).toBe(true);
    expect(
      accepts(
        { type: "id", tableName: "a" },
        { type: "id", tableName: "b" },
        {
          extraFieldsAllowed: false,
        },
      ),
    ).toBe(false);
  });

  it("ignores internal-only changes for old-client purposes", () => {
    const before = {
      "m:i": {
        kind: "mutation" as const,
        visibility: "internal" as const,
        args: object({ a: [string] }),
        returns: { type: "any" as const },
      },
    };
    expect(breakingChanges(before, {})).toEqual([]);
  });
});
