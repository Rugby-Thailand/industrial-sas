import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { signUploadReceipt } from "../../convex/lib/uploadReceipt";
import {
  PUBLIC_API_ACTOR,
  PUBLIC_API_FOREIGN_ACTOR,
  createPublicApiWorld,
} from "../fixtures/public-api-examples";
const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../convex/**/*.ts",
      "!../../convex/_generated/**",
      "!../../convex/model/**",
      "!../../convex/**/*.test.ts",
      "!../../convex/schema.ts",
      "!../../convex/auth.config.ts",
    ]),
  ).map(([path, load]) => [path.replace("../../convex/", "../convex/"), load]),
);
beforeEach(() =>
  vi.stubEnv(
    "UPLOADTHING_TOKEN",
    btoa(JSON.stringify({ apiKey: "synthetic-server-only-key" })),
  ),
);
afterEach(() => vi.unstubAllEnvs());
const item = {
  factoryOrder: "FO12345678",
  productBarcodeText: "SKU-1",
  source: "MANUAL" as const,
};

it("refuses an arbitrary URL at the registered save boundary without writing a scan", async () => {
  const w = await createPublicApiWorld(modules);
  const result = await w.t
    .withIdentity(PUBLIC_API_ACTOR)
    .mutation(api.finishedGoods.jobScans.saveJobScans, {
      warehouseId: w.warehouses.alphaA,
      requestId: "url-injection",
      locationText: "Dock",
      items: [{ ...item, imageUrl: "https://foreign.ufs.sh/f/foreign-file" }],
    });
  expect(result).toMatchObject({
    value: { written: false, error: { code: "ATTACHMENT_INVALID" } },
  });
  expect(
    await w.t.run((ctx) => ctx.db.query("finishedGoodsJobScans").collect()),
  ).toEqual([]);
});

async function uploaded(w: Awaited<ReturnType<typeof createPublicApiWorld>>) {
  const intent = await w.t
    .withIdentity(PUBLIC_API_ACTOR)
    .mutation(api.finishedGoods.attachments.createIntent, {
      warehouseId: w.warehouses.alphaA,
    });
  if (!intent.ok || !intent.value) throw new Error("intent refused");
  const receipt = {
    assetId: intent.value.assetId,
    fileKey: "owned-file",
    url: "https://fixture.ufs.sh/f/owned-file",
    size: 123,
    mimeType: "image/webp",
  };
  await w.t.mutation(api.finishedGoods.attachments.finalizeUpload, {
    ...receipt,
    signature: await signUploadReceipt(receipt),
  });
  return receipt;
}
it("does not accept a forged callback even when the attacker knows the intent ID", async () => {
  const w = await createPublicApiWorld(modules);
  const receipt = await uploaded(w);
  await expect(
    w.t.mutation(api.finishedGoods.attachments.finalizeUpload, {
      ...receipt,
      fileKey: "foreign-file",
      signature: "a".repeat(64),
    }),
  ).rejects.toThrow("Upload receipt invalid");
});
it("refuses a cross-org attachment, attaches only once in its warehouse and preserves it on correction", async () => {
  const w = await createPublicApiWorld(modules);
  const receipt = await uploaded(w);
  const save = (
    identity: typeof PUBLIC_API_ACTOR,
    warehouseId: typeof w.warehouses.alphaA,
    requestId: string,
  ) =>
    w.t
      .withIdentity(identity)
      .mutation(api.finishedGoods.jobScans.saveJobScans, {
        warehouseId,
        requestId,
        locationText: "Dock",
        items: [{ ...item, imageAssetId: receipt.assetId }],
      });
  const foreign = await save(
    PUBLIC_API_FOREIGN_ACTOR,
    w.warehouses.alphaB,
    "foreign",
  );
  expect(foreign).toMatchObject({
    value: { written: false, error: { code: "ATTACHMENT_INVALID" } },
  });
  await w.t.run(async (ctx) => {
    const membership = await ctx.db
      .query("memberships")
      .filter((q) =>
        q.and(q.eq(q.field("orgId"), w.orgA), q.eq(q.field("userId"), w.userA)),
      )
      .unique();
    if (!membership) throw new Error("membership missing");
    await ctx.db.insert("membershipWarehouses", {
      orgId: w.orgA,
      membershipId: membership._id,
      warehouseId: w.warehouses.bravoA,
    });
  });
  expect(
    await save(PUBLIC_API_ACTOR, w.warehouses.bravoA, "other-warehouse"),
  ).toMatchObject({
    value: { written: false, error: { code: "ATTACHMENT_INVALID" } },
  });
  const saved = await save(PUBLIC_API_ACTOR, w.warehouses.alphaA, "owned");
  expect(saved).toMatchObject({ value: { written: true } });
  expect(
    await save(PUBLIC_API_ACTOR, w.warehouses.alphaA, "owned"),
  ).toMatchObject({ value: { written: true, replayed: true } });
  expect(
    await save(PUBLIC_API_ACTOR, w.warehouses.alphaA, "duplicate"),
  ).toMatchObject({
    value: { written: false, error: { code: "ATTACHMENT_INVALID" } },
  });
  const scan = await w.t.run((ctx) =>
    ctx.db.query("finishedGoodsJobScans").unique(),
  );
  expect(scan).toMatchObject({
    imageAssetId: receipt.assetId,
    imageUrl: receipt.url,
  });
  const read = await w.t
    .withIdentity(PUBLIC_API_ACTOR)
    .query(api.finishedGoods.jobScans.listJobScans, {
      warehouseId: w.warehouses.alphaA,
      filter: "ALL",
    });
  expect(read).toMatchObject({
    value: {
      items: [
        expect.objectContaining({ id: scan!._id, imageUrl: receipt.url }),
      ],
    },
  });
  const foreignRead = await w.t
    .withIdentity(PUBLIC_API_FOREIGN_ACTOR)
    .query(api.finishedGoods.jobScans.listJobScans, {
      warehouseId: w.warehouses.alphaB,
      filter: "ALL",
    });
  expect(foreignRead).toMatchObject({ value: { items: [] } });
  await w.t
    .withIdentity(PUBLIC_API_ACTOR)
    .mutation(api.finishedGoods.jobScans.updateJobScan, {
      warehouseId: w.warehouses.alphaA,
      jobScanId: scan!._id,
      requestId: "correct",
      expectedVersion: 1,
      fields: { factoryOrder: "FO12345679", productBarcodeText: "SKU-1" },
    });
  expect(await w.t.run((ctx) => ctx.db.get(scan!._id))).toMatchObject({
    imageAssetId: receipt.assetId,
    imageUrl: receipt.url,
  });
});
it("claims expired detached uploads but keeps attached assets, then forgets only confirmed deletions", async () => {
  const w = await createPublicApiWorld(modules);
  const receipt = await uploaded(w);
  await w.t.run((ctx) =>
    ctx.db.patch(receipt.assetId, { expiresAt: Date.now() - 1 }),
  );
  expect(
    await w.t.mutation(internal.finishedGoods.attachments.claimExpired, {
      orgId: w.orgA,
    }),
  ).toEqual([{ assetId: receipt.assetId, fileKey: receipt.fileKey }]);
  expect(await w.t.run((ctx) => ctx.db.get(receipt.assetId))).toMatchObject({
    state: "DELETING",
  });
  const refused = await w.t
    .withIdentity(PUBLIC_API_ACTOR)
    .mutation(api.finishedGoods.jobScans.saveJobScans, {
      warehouseId: w.warehouses.alphaA,
      requestId: "expired",
      locationText: "Dock",
      items: [{ ...item, imageAssetId: receipt.assetId }],
    });
  expect(refused).toMatchObject({ value: { written: false } });
  await w.t.mutation(internal.finishedGoods.attachments.finishDeletion, {
    assetId: receipt.assetId,
  });
  expect(await w.t.run((ctx) => ctx.db.get(receipt.assetId))).toBeNull();
});

it("never sweeps attached photos and releases a deleted scan's asset after a recovery grace period", async () => {
  const w = await createPublicApiWorld(modules);
  const receipt = await uploaded(w);
  await w.t
    .withIdentity(PUBLIC_API_ACTOR)
    .mutation(api.finishedGoods.jobScans.saveJobScans, {
      warehouseId: w.warehouses.alphaA,
      requestId: "attach",
      locationText: "Dock",
      items: [{ ...item, imageAssetId: receipt.assetId }],
    });
  const scan = await w.t.run((ctx) =>
    ctx.db.query("finishedGoodsJobScans").unique(),
  );
  await w.t.run((ctx) => ctx.db.patch(receipt.assetId, { expiresAt: 1 }));
  expect(
    await w.t.mutation(internal.finishedGoods.attachments.claimExpired, {
      orgId: w.orgA,
    }),
  ).toEqual([]);
  await w.t
    .withIdentity(PUBLIC_API_ACTOR)
    .mutation(api.finishedGoods.jobScans.deleteJobScans, {
      warehouseId: w.warehouses.alphaA,
      requestId: "delete",
      ids: [scan!._id],
    });
  const asset = await w.t.run((ctx) => ctx.db.get(receipt.assetId));
  expect(asset).toMatchObject({ state: "READY" });
  expect(asset?.jobScanId).toBeUndefined();
  expect(asset!.expiresAt).toBeGreaterThan(Date.now() + 6 * 86_400_000);
});

it("retries an unconfirmed provider deletion, including a lost callback by server-assigned custom ID", async () => {
  vi.stubEnv(
    "UPLOADTHING_TOKEN",
    btoa(
      JSON.stringify({
        apiKey: "sk_synthetic",
        appId: "fixture-app",
        regions: ["sea1"],
      }),
    ),
  );
  const w = await createPublicApiWorld(modules);
  const receipt = await uploaded(w);
  const pending = await w.t
    .withIdentity(PUBLIC_API_ACTOR)
    .mutation(api.finishedGoods.attachments.createIntent, {
      warehouseId: w.warehouses.alphaA,
    });
  if (!pending.ok || !pending.value) throw new Error("intent refused");
  const pendingId = pending.value.assetId;
  await w.t.run(async (ctx) => {
    await ctx.db.patch(receipt.assetId, { expiresAt: 1 });
    await ctx.db.patch(pendingId, { expiresAt: 1 });
  });
  const requests: unknown[] = [];
  const transport = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(new URL(request.url).pathname).toBe("/v6/deleteFiles");
      requests.push(await request.json());
      return Response.json({ success: false, deletedCount: 0 });
    },
  );
  vi.stubGlobal("fetch", transport);
  try {
    expect(
      await w.t.action(internal.finishedGoods.attachmentCleanup.cleanup, {
        orgId: w.orgA,
      }),
    ).toEqual({ deleted: 0, failed: 2 });
    expect(await w.t.run((ctx) => ctx.db.get(receipt.assetId))).not.toBeNull();
    expect(await w.t.run((ctx) => ctx.db.get(pendingId))).not.toBeNull();
    transport.mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      requests.push(await request.json());
      return Response.json({ success: true, deletedCount: 1 });
    });
    await w.t.action(internal.finishedGoods.attachmentCleanup.cleanup, {
      orgId: w.orgA,
    });
    expect(requests).toContainEqual({ fileKeys: [receipt.fileKey] });
    expect(requests).toContainEqual({ customIds: [pendingId] });
    expect(
      await w.t.run((ctx) => ctx.db.query("jobTicketAssets").collect()),
    ).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("rejects foreign and inactive upload intents at their registered permission boundary", async () => {
  const w = await createPublicApiWorld(modules);
  for (const warehouseId of [w.warehouses.alphaB, w.warehouses.deltaA]) {
    await expect(
      w.t
        .withIdentity(PUBLIC_API_ACTOR)
        .mutation(api.finishedGoods.attachments.createIntent, { warehouseId }),
    ).rejects.toThrow();
  }
  expect(
    await w.t.run((ctx) => ctx.db.query("jobTicketAssets").collect()),
  ).toEqual([]);
});

it("does not partially attach a valid photo when another ticket in the same command is invalid", async () => {
  const w = await createPublicApiWorld(modules);
  const receipt = await uploaded(w);
  const result = await w.t
    .withIdentity(PUBLIC_API_ACTOR)
    .mutation(api.finishedGoods.jobScans.saveJobScans, {
      warehouseId: w.warehouses.alphaA,
      requestId: "atomic",
      locationText: "Dock",
      items: [
        { ...item, imageAssetId: receipt.assetId },
        { ...item, imageUrl: "https://foreign.ufs.sh/f/foreign-file" },
      ],
    });
  expect(result).toMatchObject({ value: { written: false } });
  expect(await w.t.run((ctx) => ctx.db.get(receipt.assetId))).toMatchObject({
    state: "READY",
  });
  expect(
    await w.t.run((ctx) => ctx.db.query("finishedGoodsJobScans").collect()),
  ).toEqual([]);
});

it.each([{ mimeType: "image/svg+xml" }, { size: 16 * 1024 * 1024 + 1 }])(
  "rejects signed but invalid upload metadata %j before finalizing",
  async (invalid) => {
    const w = await createPublicApiWorld(modules);
    const intent = await w.t
      .withIdentity(PUBLIC_API_ACTOR)
      .mutation(api.finishedGoods.attachments.createIntent, {
        warehouseId: w.warehouses.alphaA,
      });
    if (!intent.ok || !intent.value) throw new Error("intent refused");
    const receipt = {
      ...intent.value,
      fileKey: "file",
      url: "https://fixture.ufs.sh/f/file",
      size: 123,
      mimeType: "image/webp",
      ...invalid,
    };
    await expect(
      w.t.mutation(api.finishedGoods.attachments.finalizeUpload, {
        ...receipt,
        signature: await signUploadReceipt(receipt),
      }),
    ).rejects.toThrow("Upload metadata invalid");
    expect(await w.t.run((ctx) => ctx.db.get(receipt.assetId))).toMatchObject({
      state: "PENDING",
    });
  },
);
it("allows only one concurrent attachment command to consume a finalized asset", async () => {
  const w = await createPublicApiWorld(modules);
  const receipt = await uploaded(w);
  const results = await Promise.all(
    ["a", "b"].map((requestId) =>
      w.t
        .withIdentity(PUBLIC_API_ACTOR)
        .mutation(api.finishedGoods.jobScans.saveJobScans, {
          warehouseId: w.warehouses.alphaA,
          requestId,
          locationText: "Dock",
          items: [{ ...item, imageAssetId: receipt.assetId }],
        }),
    ),
  );
  expect(
    results.filter((result) => result.ok && result.value.written),
  ).toHaveLength(1);
  expect(
    await w.t.run((ctx) => ctx.db.query("finishedGoodsJobScans").collect()),
  ).toHaveLength(1);
});

it("runs the registered scheduled dispatcher and bounds each tenant expiry batch", async () => {
  vi.stubEnv(
    "UPLOADTHING_TOKEN",
    btoa(
      JSON.stringify({
        apiKey: "sk_synthetic",
        appId: "fixture-app",
        regions: ["sea1"],
      }),
    ),
  );
  const w = await createPublicApiWorld(modules);
  await w.t.run(async (ctx) => {
    for (let i = 0; i < 21; i++)
      await ctx.db.insert("jobTicketAssets", {
        orgId: w.orgA,
        warehouseId: w.warehouses.alphaA,
        createdByUserId: w.userA,
        state: "PENDING",
        expiresAt: 1,
      });
    await ctx.db.insert("jobTicketAssets", {
      orgId: w.orgB,
      warehouseId: w.warehouses.alphaB,
      createdByUserId: w.userA,
      state: "PENDING",
      expiresAt: 1,
    });
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ success: true, deletedCount: 1 })),
  );
  vi.useFakeTimers();
  try {
    await w.t.mutation(internal.finishedGoods.attachments.dispatchCleanup, {});
    await w.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const remaining = await w.t.run((ctx) =>
      ctx.db.query("jobTicketAssets").collect(),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ orgId: w.orgA, state: "PENDING" });
    // A subsequent hourly run resumes the finite batch without a fragile delete cursor.
    await w.t.mutation(internal.finishedGoods.attachments.dispatchCleanup, {});
    await w.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await w.t.run((ctx) => ctx.db.query("jobTicketAssets").collect()),
    ).toEqual([]);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
