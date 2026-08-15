import type { GenericMutationCtx } from "convex/server";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  applyLegacyMasterCardImportChunk,
  previewLegacyMasterCardImport,
} from "../../convex/engineering/masterCardImports";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const call = async (world: ConvexInventoryWorld, fn: unknown, args: unknown) =>
  (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;

const value = (outcome: Record<string, unknown>) => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
};

describe("legacy master-card import", () => {
  it("previews, persists a resume cursor, preserves source references, and replays", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const customerId = await world.t.run(
      async (ctx) =>
        await ctx.db.insert("customers", {
          orgId: world.orgA,
          code: "LEGACY",
          name: "Legacy customer",
          status: "ACTIVE",
        }),
    );
    const row = (sourceRow: number) => ({
      sourceRow,
      sourceReference: `cabinet/card-${sourceRow}.pdf`,
      cardNumber: `LEG-${sourceRow}`,
      customerId,
      customerProductCode: `FG-LEG-${sourceRow}`,
      name: `Legacy card ${sourceRow}`,
      verified: false,
      specification: {
        styleCode: "RSC",
        internalLengthMm: 300,
        internalWidthMm: 200,
        internalHeightMm: 150,
        boardGrade: "KA125/C/KA125",
        printColourCount: 1,
      },
      files: [],
    });

    const preview = value(
      await call(world, previewLegacyMasterCardImport, { rows: [row(1)] }),
    );
    expect(preview).toMatchObject({ problems: [], nextSourceRow: 2 });
    expect((preview["accepted"] as unknown[])[0]).toMatchObject({
      revisionStatus: "DRAFT",
      sourceReference: "cabinet/card-1.pdf",
    });

    const firstArgs = {
      requestId: "legacy-import-1",
      batchRef: "LEGACY-2026",
      rows: [row(1)],
    };
    expect(
      value(await call(world, applyLegacyMasterCardImportChunk, firstArgs)),
    ).toMatchObject({
      written: true,
      replayed: false,
    });
    expect(
      value(await call(world, applyLegacyMasterCardImportChunk, firstArgs)),
    ).toMatchObject({
      written: true,
      replayed: true,
    });
    value(
      await call(world, applyLegacyMasterCardImportChunk, {
        requestId: "legacy-import-2",
        batchRef: "LEGACY-2026",
        rows: [row(2)],
      }),
    );

    const stored = await world.t.run(async (ctx) => ({
      cards: await ctx.db.query("masterCards").collect(),
      revisions: await ctx.db.query("masterCardRevisions").collect(),
      chunks: await ctx.db.query("masterCardImportChunks").collect(),
    }));
    expect(stored.cards).toHaveLength(2);
    expect(stored.revisions).toHaveLength(2);
    expect(stored.revisions.every((row) => row.status === "DRAFT")).toBe(true);
    expect(stored.revisions.map((row) => row.legacySourceReference)).toEqual([
      "cabinet/card-1.pdf",
      "cabinet/card-2.pdf",
    ]);
    expect(stored.chunks.map((row) => row.nextSourceRow)).toEqual([2, 3]);
  });

  it("resumes from an exact predecessor after more than one hundred chunks", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const customerId = await world.t.run(async (ctx) => {
      const id = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "LONG-IMPORT",
        name: "Long import customer",
        status: "ACTIVE",
      });
      for (let sourceRow = 1; sourceRow <= 101; sourceRow += 1) {
        await ctx.db.insert("masterCardImportChunks", {
          orgId: world.orgA,
          batchRef: "LONG-2026",
          startSourceRow: sourceRow,
          nextSourceRow: sourceRow + 1,
          importedCount: 1,
          releasedCount: 0,
          draftCount: 1,
          importedByUserId: world.userA,
          completedAt: sourceRow,
        });
      }
      return id;
    });
    const result = value(
      await call(world, applyLegacyMasterCardImportChunk, {
        requestId: "legacy-import-102",
        batchRef: "LONG-2026",
        rows: [
          {
            sourceRow: 102,
            sourceReference: "cabinet/card-102.pdf",
            cardNumber: "LEG-102",
            customerId,
            customerProductCode: "FG-LEG-102",
            name: "Legacy card 102",
            verified: false,
            specification: {
              styleCode: "RSC",
              internalLengthMm: 300,
              internalWidthMm: 200,
              internalHeightMm: 150,
              boardGrade: "KA125/C/KA125",
              printColourCount: 1,
            },
            files: [],
          },
        ],
      }),
    );
    expect(result).toMatchObject({ written: true, replayed: false });
  });

  it("refuses a chunk that skips or reorders source rows", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const customerId = await world.t.run(
      async (ctx) =>
        await ctx.db.insert("customers", {
          orgId: world.orgA,
          code: "GAPPED",
          name: "Gapped import customer",
          status: "ACTIVE",
        }),
    );
    const base = {
      sourceReference: "legacy.pdf",
      cardNumber: "LEG-GAP-1",
      customerId,
      customerProductCode: "FG-GAP-1",
      name: "Gapped card",
      verified: false,
      specification: {
        styleCode: "RSC",
        internalLengthMm: 300,
        internalWidthMm: 200,
        internalHeightMm: 150,
        boardGrade: "KA125/C/KA125",
        printColourCount: 1,
      },
      files: [],
    };
    const preview = value(
      await call(world, previewLegacyMasterCardImport, {
        rows: [
          { ...base, sourceRow: 1 },
          {
            ...base,
            sourceRow: 3,
            cardNumber: "LEG-GAP-3",
            customerProductCode: "FG-GAP-3",
          },
        ],
      }),
    );
    expect(preview["problems"]).toContainEqual({
      code: "NON_CONTIGUOUS_CHUNK",
      sourceRow: 3,
      field: "sourceRow",
    });
  });

  it("refuses storage bytes that were not bound to the row's upload grant", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const bytes = "private legacy drawing";
    const seeded = await world.t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "BOUND",
        name: "Bound import customer",
        status: "ACTIVE",
      });
      const claimedStorageId = await ctx.storage.store(
        new Blob(["different bytes"], { type: "application/pdf" }),
      );
      const arbitraryStorageId = await ctx.storage.store(
        new Blob([bytes], { type: "application/pdf" }),
      );
      const uploadGrantId = await ctx.db.insert("masterCardUploadGrants", {
        orgId: world.orgA,
        batchRef: "BOUND-2026",
        sourceRow: 1,
        authorizedByUserId: world.userA,
        expiresAt: Date.now() + 60_000,
        uploadStartedAt: Date.now(),
        consumedStorageId: claimedStorageId,
        consumedAt: Date.now(),
      });
      return { customerId, arbitraryStorageId, uploadGrantId };
    });
    const outcome = value(
      await call(world, applyLegacyMasterCardImportChunk, {
        requestId: "legacy-import-unbound",
        batchRef: "BOUND-2026",
        rows: [
          {
            sourceRow: 1,
            sourceReference: "legacy/unbound.pdf",
            cardNumber: "LEG-BOUND-1",
            customerId: seeded.customerId,
            customerProductCode: "FG-BOUND-1",
            name: "Unbound legacy card",
            verified: false,
            specification: {
              styleCode: "RSC",
              internalLengthMm: 300,
              internalWidthMm: 200,
              internalHeightMm: 150,
              boardGrade: "KA125/C/KA125",
              printColourCount: 1,
            },
            files: [
              {
                fileKey: "DIELINE-1",
                fileName: "unbound.pdf",
                kind: "DIELINE",
                contentType: "application/pdf",
                byteSize: bytes.length,
                contentDigest: createHash("sha256").update(bytes).digest("hex"),
                storageId: seeded.arbitraryStorageId,
                uploadGrantId: seeded.uploadGrantId,
              },
            ],
          },
        ],
      }),
    );
    expect(outcome).toMatchObject({
      written: false,
      error: { field: "uploadGrantId", reason: "UPLOAD_GRANT_INVALID" },
    });
  });
});
