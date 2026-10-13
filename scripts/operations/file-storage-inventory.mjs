// Read-only inventory. Customer records, URLs, IDs and credentials never leave
// this module. A failed or truncated scan never produces clearance evidence.
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { loadTargets } from "../release/lib/env-contract.mjs";

const PHOTO_FIELD = /^(photoURLs?|imageURLs?)$/i;
const CONVEX_FILE_FIELD = /^(storageId|fileStorageId)$/i;
const TABLES = makeFunctionReference("_system/cli/tables");
const DATA = makeFunctionReference("_system/cli/tableData");

export function createFileReferenceSummary(storageRows) {
  const ids = new Set(storageRows.map((row) => row._id));
  if (ids.has(undefined) || ids.size !== storageRows.length)
    throw new Error("Invalid storage metadata");
  const referenced = new Set();
  const counts = {
    storageObjects: ids.size,
    storageBytes: 0,
    storageReferences: 0,
    convexFileUrls: 0,
    unresolvedStorageIds: 0,
    photoUrls: { convex: 0, uploadthing: 0, other: 0, invalid: 0 },
  };
  for (const row of storageRows) {
    if (!Number.isSafeInteger(row.size) || row.size < 0)
      throw new Error("Invalid storage size");
    counts.storageBytes += row.size;
    if (!Number.isSafeInteger(counts.storageBytes))
      throw new Error("Invalid storage size");
  }
  function visit(value, field = "") {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, field);
    } else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        // Document identity is not a file reference.
        if (key !== "_id") visit(entry, key);
      }
    } else if (typeof value === "string") {
      if (ids.has(value)) {
        counts.storageReferences++;
        referenced.add(value);
      } else if (CONVEX_FILE_FIELD.test(field) && value.trim()) {
        counts.unresolvedStorageIds++;
      }
      let provider = "invalid";
      try {
        const url = new URL(value);
        if (["https:", "http:"].includes(url.protocol)) {
          const convex =
            url.hostname.endsWith(".convex.cloud") &&
            url.pathname.startsWith("/api/storage/");
          provider = convex
            ? "convex"
            : /(^|\.)(ufs\.sh|utfs\.io)$/.test(url.hostname)
              ? "uploadthing"
              : "other";
          if (convex) {
            counts.convexFileUrls++;
            const id = decodeURIComponent(
              url.pathname.slice("/api/storage/".length),
            );
            if (ids.has(id)) referenced.add(id);
          }
        }
      } catch {
        // Malformed photo references are counted without retaining their value.
      }
      if (PHOTO_FIELD.test(field) && value.trim()) counts.photoUrls[provider]++;
    }
  }
  return {
    addDocument: (document) => visit(document),
    result: () => ({
      ...counts,
      photoUrls: { ...counts.photoUrls },
      referencedStorageObjects: referenced.size,
      unreferencedStorageObjects: ids.size - referenced.size,
    }),
  };
}

export async function inventoryFileStorage(input, deps = {}) {
  const target = ["production", "staging"].includes(input.targetName)
    ? loadTargets().targets[input.targetName]
    : null;
  if (
    !target ||
    typeof input.adminKey !== "string" ||
    (input.adminKey.includes("|") &&
      !input.adminKey.startsWith(
        `${target.convexDeployKeyClass}:${target.convexDeployment}|`,
      )) ||
    /\s/.test(input.adminKey) ||
    !input.adminKey ||
    input.adminKey.startsWith("preview:") ||
    input.adminKey.startsWith("project:") ||
    input.adminKey.endsWith("|")
  )
    return { ok: false, code: "INVALID_INVENTORY_TARGET" };
  const origin = `https://${target.convexDeployment}.convex.cloud`;
  const now = deps.now ?? Date.now;
  const startedAtMs = now();
  const deadline = startedAtMs + 5 * 60_000;
  try {
    const client = deps.clientFactory
      ? deps.clientFactory(origin)
      : new ConvexHttpClient(origin, {
          logger: false,
          fetch: (url, options) => {
            const parsed = new URL(url);
            if (
              parsed.origin !== origin ||
              parsed.pathname !== "/api/query" ||
              options?.method !== "POST"
            )
              throw new Error("Unreviewed inventory endpoint");
            return fetch(url, {
              ...options,
              redirect: "error",
              signal: AbortSignal.timeout(
                Math.max(1, Math.min(15_000, deadline - now())),
              ),
            });
          },
        });
    client.setAdminAuth(input.adminKey);
    async function pages(reference, args, consume) {
      let cursor = null;
      const cursors = new Set();
      for (let page = 0; page < 1_000; page++) {
        if (now() >= deadline) throw new Error("Inventory deadline");
        const result = await client.query(reference, {
          ...args,
          paginationOpts: { numItems: 500, cursor },
        });
        if (
          !result ||
          !Array.isArray(result.page) ||
          typeof result.isDone !== "boolean"
        )
          throw new Error("Invalid inventory page");
        consume(result.page);
        if (result.isDone) return;
        cursor = result.continueCursor;
        if (typeof cursor !== "string" || !cursor || cursors.has(cursor))
          throw new Error("Invalid inventory cursor");
        cursors.add(cursor);
      }
      throw new Error("Inventory page limit");
    }
    const storage = [];
    await pages(DATA, { table: "_storage", order: "asc" }, (rows) =>
      storage.push(...rows),
    );
    const summary = createFileReferenceSummary(storage);
    const tables = [];
    await pages(TABLES, {}, (rows) => tables.push(...rows));
    const names = tables.map((row) => row.name);
    if (
      names.some(
        (name) =>
          typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name),
      ) ||
      new Set(names).size !== names.length
    )
      throw new Error("Invalid table inventory");
    let documents = 0;
    for (const table of names) {
      await pages(DATA, { table, order: "asc" }, (rows) => {
        documents += rows.length;
        for (const row of rows) summary.addDocument(row);
      });
    }
    // Check storage again: a changing file inventory cannot prove accounting.
    const after = [];
    await pages(DATA, { table: "_storage", order: "asc" }, (rows) =>
      after.push(...rows),
    );
    if (JSON.stringify(storage) !== JSON.stringify(after))
      throw new Error("Storage changed during inventory");
    return {
      ok: true,
      code: "INVENTORY_COMPLETED",
      schema: 1,
      target: input.targetName,
      startedAtMs,
      completedAtMs: now(),
      tables: names.length,
      documents,
      ...summary.result(),
      // Pagination spans independent reads, not an atomic database snapshot.
      atomicSnapshot: false,
    };
  } catch {
    return { ok: false, code: "INVENTORY_FAILED" };
  }
}
