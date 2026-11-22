import { TENANT_INDEX_MAX_PAGE_SIZE } from "../lib/tenantDb";

/**
 * Bounded keyset reads for customer activity (summaries, detail, product
 * pages). Every read is a `take()` of at most one tenant page, so one request
 * may continue through several ranges without `.paginate()`, and a shared
 * budget caps the documents any request can scan.
 */

export type ScanKey = string | number;

/** Resume point: last consumed key plus IDs already consumed at that key. */
export interface ScanPosition {
  readonly k: ScanKey;
  readonly ids: readonly string[];
}

/** Rows (documents, or document-read equivalents) a request may still spend. */
export interface ScanBudget {
  remaining: number;
}

export interface ScanResult<R> {
  readonly items: { readonly item: R; readonly position: ScanPosition }[];
  /** The index range was read to its end. */
  readonly done: boolean;
  /** Where to continue when not done; absent before the first row. */
  readonly position?: ScanPosition;
}

/**
 * Visit rows in index order from `start` (inclusive of its key, skipping its
 * consumed IDs), accepting until `want` items, the end of the range, or the
 * budget. `readBatch(bound, limit)` must return rows ordered by `key` whose key
 * is at or past `bound` (inclusive) in the scan direction.
 */
export async function scanVisible<T extends { readonly _id: string }, R>({
  readBatch,
  key,
  accept,
  want,
  budget,
  start,
}: {
  readonly readBatch: (
    bound: ScanKey | undefined,
    limit: number,
  ) => Promise<readonly T[]>;
  readonly key: (row: T) => ScanKey;
  readonly accept: (row: T) => Promise<R | null>;
  readonly want: number;
  readonly budget: ScanBudget;
  readonly start?: ScanPosition | undefined;
}): Promise<ScanResult<R>> {
  const items: { item: R; position: ScanPosition }[] = [];
  let bound = start?.k;
  let idsAtBound = new Set(start?.ids ?? []);
  const position = (): ScanPosition | undefined =>
    bound === undefined ? undefined : { k: bound, ids: [...idsAtBound] };

  for (let batch = 0; ; batch += 1) {
    if (budget.remaining <= 0) {
      return { items, done: false, ...withPosition(position()) };
    }
    // Dense ranges read only what is wanted (plus the consumed ties at a
    // resumed bound); once rows were filtered out, read full batches.
    const need =
      batch === 0
        ? want - items.length + idsAtBound.size
        : Number.POSITIVE_INFINITY;
    const limit = Math.min(TENANT_INDEX_MAX_PAGE_SIZE, budget.remaining, need);
    const rows = await readBatch(bound, limit);
    budget.remaining -= rows.length;
    let advanced = false;
    for (const row of rows) {
      const rowKey = key(row);
      if (rowKey === bound) {
        if (idsAtBound.has(row._id)) continue;
      } else {
        bound = rowKey;
        idsAtBound = new Set();
      }
      idsAtBound.add(row._id);
      advanced = true;
      const accepted = await accept(row);
      if (accepted !== null) {
        items.push({ item: accepted, position: position()! });
        if (items.length >= want) {
          return { items, done: false, ...withPosition(position()) };
        }
      }
    }
    if (rows.length < limit) return { items, done: true };
    // A full batch of already-consumed ties cannot advance an inclusive bound.
    if (!advanced) return { items, done: false, ...withPosition(position()) };
  }
}

function withPosition(position: ScanPosition | undefined) {
  return position === undefined ? {} : { position };
}

const MAX_CURSOR_IDS = 100;

/** Opaque cursor for a numeric `_creationTime` keyset position. */
export function encodeScanCursor(position: ScanPosition | undefined): string {
  return position === undefined ? "" : JSON.stringify(position);
}

export function decodeScanCursor(
  raw: string | undefined,
): ScanPosition | undefined {
  if (raw === undefined || raw === "") return undefined;
  try {
    const value = JSON.parse(raw) as Partial<ScanPosition> | null;
    if (
      typeof value?.k === "number" &&
      Number.isFinite(value.k) &&
      Array.isArray(value.ids) &&
      value.ids.length <= MAX_CURSOR_IDS &&
      value.ids.every((id) => typeof id === "string")
    ) {
      return { k: value.k, ids: value.ids };
    }
  } catch {
    // Rejected below.
  }
  throw new Error("INVALID_CURSOR");
}
