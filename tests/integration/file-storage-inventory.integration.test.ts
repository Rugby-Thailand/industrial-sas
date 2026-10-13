import { describe, expect, it, vi } from "vitest";
import {
  createFileReferenceSummary,
  inventoryFileStorage,
} from "../../scripts/operations/file-storage-inventory.mjs";

const key = "prod:greedy-cardinal-537|placeholder";
const page = (rows: unknown[], cursor = "done", isDone = true) => ({
  page: rows,
  continueCursor: cursor,
  isDone,
});
function world(responses: unknown[]) {
  const query = vi.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  const setAdminAuth = vi.fn();
  const clientFactory = vi.fn(() => ({ query, setAdminAuth }));
  return { query, setAdminAuth, clientFactory };
}

describe("redacted read-only file inventory", () => {
  it("accounts for exact storage IDs and nested photo references without publishing values", () => {
    const summary = createFileReferenceSummary([
      { _id: "private-file-id", size: 11 },
      { _id: "unreferenced-file-id", size: 4 },
    ]);
    summary.addDocument({
      _id: "unreferenced-file-id",
      nested: [
        {
          storageId: "private-file-id",
          photoURLs: [
            "https://example.convex.cloud/api/storage/private-file-id",
            "https://app.ufs.sh/f/private-file-key",
            "https://utfs.io/f/private-file-key",
            "https://example.com/customer-image",
            "private-invalid-url",
          ],
        },
      ],
      storageId: "missing-private-id",
    });
    const result = summary.result();
    expect(result).toEqual({
      storageObjects: 2,
      storageBytes: 15,
      storageReferences: 1,
      convexFileUrls: 1,
      unresolvedStorageIds: 1,
      photoUrls: { convex: 1, uploadthing: 2, other: 1, invalid: 1 },
      referencedStorageObjects: 1,
      unreferencedStorageObjects: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/private|https|customer/);
  });

  it("does not count lookalike hosts as provider URLs", () => {
    const summary = createFileReferenceSummary([]);
    summary.addDocument({
      imageUrl: "https://ufs.sh.attacker.example/f/key",
      nested: {
        photoUrl:
          "https://example.convex.cloud.attacker.example/api/storage/key",
      },
    });
    expect(summary.result().photoUrls).toEqual({
      convex: 0,
      uploadthing: 0,
      other: 2,
      invalid: 0,
    });
  });

  it("exhausts table and document pagination, then rechecks storage", async () => {
    const w = world([
      page([]),
      page([{ name: "scans" }], "tables-next", false),
      page([{ name: "employees" }]),
      page(
        [{ imageUrl: "https://app.ufs.sh/f/private-file" }],
        "docs-next",
        false,
      ),
      page([
        { photoURLs: ["https://example.convex.cloud/api/storage/private-id"] },
      ]),
      page([]),
      page([]),
    ]);
    const result = await inventoryFileStorage(
      { targetName: "production", adminKey: key },
      { ...w, now: () => 100 },
    );
    expect(result).toMatchObject({
      ok: true,
      code: "INVENTORY_COMPLETED",
      tables: 2,
      documents: 2,
      storageObjects: 0,
      convexFileUrls: 1,
      photoUrls: { convex: 1, uploadthing: 1 },
      atomicSnapshot: false,
    });
    expect(w.query).toHaveBeenCalledTimes(7);
    expect(w.query.mock.calls[4]?.[1]).toMatchObject({
      paginationOpts: { cursor: "docs-next" },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|https|placeholder/);
  });

  it.each(["staging", "unknown", "__proto__", "constructor", undefined])(
    "refuses wrong target before constructing a client: %s",
    async (targetName) => {
      const w = world([]);
      expect(
        await inventoryFileStorage({ targetName, adminKey: key }, w),
      ).toEqual({ ok: false, code: "INVALID_INVENTORY_TARGET" });
      expect(w.clientFactory).not.toHaveBeenCalled();
    },
  );

  it.each([
    "prod:greedy-cardinal-537|",
    "prod:greedy-cardinal-537|secret\n",
    "preview:team:project|secret",
  ])("refuses invalid credentials", async (adminKey) => {
    const w = world([]);
    expect(
      (await inventoryFileStorage({ targetName: "production", adminKey }, w))
        .ok,
    ).toBe(false);
    expect(w.clientFactory).not.toHaveBeenCalled();
  });

  it.each([
    [
      page([]),
      page([{ name: "scans" }]),
      page([], "same", false),
      page([], "same", false),
    ],
    [page([]), { page: [], isDone: false }],
    [page([]), page([{ name: "scans" }, { name: "scans" }])],
    [page([]), page([{ name: "scans" }]), { page: null, isDone: true }],
    [page([]), page([]), page([{ _id: "new-private-file", size: 1 }])],
  ])(
    "suppresses partial inventory on malformed pages or changing storage %#",
    async (...responses) => {
      const w = world(responses);
      expect(
        await inventoryFileStorage(
          { targetName: "production", adminKey: key },
          w,
        ),
      ).toEqual({ ok: false, code: "INVENTORY_FAILED" });
    },
  );

  it("accepts a raw operator admin key only for a reviewed fixed origin", async () => {
    const w = world([page([]), page([]), page([])]);
    const result = await inventoryFileStorage(
      { targetName: "staging", adminKey: "raw-admin-placeholder" },
      w,
    );
    expect(result.ok).toBe(true);
    expect(w.clientFactory).toHaveBeenCalledWith(
      "https://befitting-stoat-208.convex.cloud",
    );
  });

  it("suppresses provider errors and credentials", async () => {
    const w = world([]);
    w.query.mockRejectedValue(
      new Error(`provider echoed ${key} and customer URL`),
    );
    expect(
      await inventoryFileStorage(
        { targetName: "production", adminKey: key },
        w,
      ),
    ).toEqual({ ok: false, code: "INVENTORY_FAILED" });
  });

  it("refuses inventory once the time budget has elapsed", async () => {
    const w = world([]);
    let reads = 0;
    expect(
      await inventoryFileStorage(
        { targetName: "production", adminKey: key },
        { ...w, now: () => (reads++ === 0 ? 100 : 300_100) },
      ),
    ).toEqual({ ok: false, code: "INVENTORY_FAILED" });
    expect(w.query).not.toHaveBeenCalled();
  });
});
