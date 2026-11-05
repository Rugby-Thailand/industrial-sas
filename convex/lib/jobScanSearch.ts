import type { Doc, Id } from "../_generated/dataModel";
import { sha256Hex } from "./idempotency";
import {
  TENANT_INDEX_TIEBREAKER,
  type TenantDocumentAccess,
  type TenantIndexEquality,
  type TenantOwnedDocument,
  type TenantTableName,
} from "./tenantDb";
import {
  codePointLength,
  gramsOf,
  isWellFormed,
  probeGrams,
  UNPOSTED_GRAM,
} from "./textGrams";
import type { BoundedRecordPage } from "./boundedRecordPage";
import type { TenantFunctionContext } from "./tenantFunctions";
import { catalogueScope } from "./cataloguePagination";
import {
  currentSearchReadiness,
  layoutGeneration,
  searchIndexReadiness,
  type CurrentSearchReadiness,
} from "./searchReadiness";

/**
 * Exact, index-backed substring search over saved job scans.
 *
 * Semantics are those of the scan it replaces: a record matches when the
 * NFKC/trim/lower-cased text of one of its seven fields, or of its effective
 * building's name, contains the equally normalized needle; results are
 * newest first (`createdAt`, then creation time). Derived rows only propose
 * candidates: every candidate is re-read and re-matched by the caller's exact
 * predicate, so a stale or extra row can cost a read but never change a
 * result, and derived rows never authorize anything.
 *
 * Completeness invariant (needles of at least 3 code points): for every scan
 * and field whose text T contains the needle, either T's term is `shared`
 * (then its trigram postings find the term and the scan's search row is in
 * the term's slot index) or the scan has per-scan trigram postings for T (or
 * an unposted row "" listing T). Building names are shared terms keyed by
 * building, found the same way, streamed through the rows' building index.
 * Writers keep the invariant in their own transaction (`indexJobScans`);
 * readers use the index only while the warehouse's readiness row is current,
 * and answer from history while building names may be stale. Rows written by
 * code that does not keep the invariant are repaired by `reconcile`
 * (`convex/lib/searchReadiness.ts`).
 */
/** 2: search rows carry `sourceHash`; readiness carries the reconcile markers. */
export const JOB_SCAN_SEARCH_VERSION = 2;
export const JOB_SCAN_SEARCH_FIELDS = [
  "factoryOrder",
  "productBarcodeText",
  "partName",
  "customer",
  "locationText",
  "locationCode",
  "locationName",
] as const;
const SLOTS = ["t0", "t1", "t2", "t3", "t4", "t5", "t6"] as const;
export const BUILDING_FIELD = 7;
/** A term linked by more scans than this is shared (posted once, as a term). */
export const SHARED_AFTER = 8;
/** Longer terms are listed under the unposted gram instead of gram by gram. */
const MAX_TERM_GRAMS = 512;
const MAX_KEY_LENGTH = 256;
/**
 * Derived writes one transaction may spend on postings before deferring the
 * rest to the scheduled re-index (deferred rows stay exact: see "" rows).
 * Search rows (one per written scan) and unposted rows are always written.
 */
export const SEARCH_WRITE_BUDGET = 1_500;
export const MIN_INDEXED_NEEDLE = 3;

type Scan = Doc<"finishedGoodsJobScans">;
type SearchRow = Doc<"finishedGoodsJobScanSearchRows">;
type Term = Doc<"finishedGoodsJobScanTerms">;
type TermGram = Doc<"finishedGoodsJobScanTermGrams">;
type ScanGram = Doc<"finishedGoodsJobScanGrams">;

const SEARCH_ROWS = "finishedGoodsJobScanSearchRows";
const TERMS = "finishedGoodsJobScanTerms";
const TERM_GRAMS = "finishedGoodsJobScanTermGrams";
const SCAN_GRAMS = "finishedGoodsJobScanGrams";

/** Case-, width- and composition-insensitive comparison text. */
export function normalizeJobScanSearch(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}
function contains(value: string | undefined, needle: string) {
  return value !== undefined && normalizeJobScanSearch(value).includes(needle);
}
/** Every job and location field shown on a saved record row. */
export function jobScanTextMatches(
  scan: Pick<Scan, (typeof JOB_SCAN_SEARCH_FIELDS)[number]>,
  needle: string,
) {
  return JOB_SCAN_SEARCH_FIELDS.some((field) => contains(scan[field], needle));
}
export function jobScanNameMatches(name: string | undefined, needle: string) {
  return contains(name, needle);
}

/** Text a needle of at least 3 code points can occur in; shorter text never can. */
function searchableText(value: string | undefined) {
  if (value === undefined) return undefined;
  const text = normalizeJobScanSearch(value);
  return codePointLength(text) >= MIN_INDEXED_NEEDLE ? text : undefined;
}
async function termKey(text: string) {
  return text.length <= MAX_KEY_LENGTH ? text : `#${await sha256Hex(text)}`;
}

export interface SearchBudget {
  left: number;
  orphanChecksLeft: number;
}
export const searchBudget = (): SearchBudget => ({
  left: SEARCH_WRITE_BUDGET,
  // Linked terms consume reads without writes. Reserve foreground headroom
  // for source validation/deletion and defer the remaining checks.
  orphanChecksLeft: 256,
});

/** The warehouse's readiness row while the index may answer, else null. */
export async function jobScanSearchIndex(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
) {
  const row = await searchIndexReadiness(db, warehouseId, "jobScans");
  return currentSearchReadiness(row, JOB_SCAN_SEARCH_VERSION) ? row : null;
}

/**
 * Everything the search rows and postings of a scan are derived from (its
 * zone's building never changes). Equal digests: nothing to re-index.
 */
export async function scanSourceHash(scan: Scan) {
  return sha256Hex(
    JSON.stringify([
      scan.warehouseId,
      scan.createdAt,
      scan.mapped,
      scan.buildingId ?? null,
      scan.zoneId ?? null,
      ...JOB_SCAN_SEARCH_FIELDS.map((field) => scan[field] ?? null),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Maintenance

/** Shared term lookups of one maintenance pass. */
function termCache(db: TenantDocumentAccess, budget: SearchBudget) {
  const byKey = new Map<string, Promise<Term>>();
  const byId = new Map<string, Promise<Term | null>>();
  const lookup = async (warehouseId: string, field: number, text: string) => {
    const key = await termKey(text);
    const rows = await db
      .byIndex<Term>(TERMS, "by_orgId_warehouseId_field_key", [
        { field: "warehouseId", value: warehouseId },
        { field: "field", value: field },
        { field: "key", value: key },
      ])
      .take(8);
    const found = rows.find((row) => row.text === text);
    if (found) return found;
    const id = await db.insert(TERMS, {
      warehouseId,
      field,
      key,
      text,
      shared: false,
    });
    budget.left -= 1;
    return (await db.get<Term>(TERMS, id))!;
  };
  return {
    resolve(warehouseId: string, field: number, text: string) {
      const cacheKey = JSON.stringify([warehouseId, field, text]);
      let found = byKey.get(cacheKey);
      if (!found) {
        found = lookup(warehouseId, field, text);
        byKey.set(cacheKey, found);
        void found.then((term) => byId.set(term._id, Promise.resolve(term)));
      }
      return found;
    },
    get(id: string) {
      let found = byId.get(id);
      if (!found) {
        found = db.get<Term>(TERMS, id);
        byId.set(id, found);
      }
      return found;
    },
  };
}

/** Term-level postings: all trigrams, or one unposted row for long text. */
async function postTerm(
  db: TenantDocumentAccess,
  term: Term,
  budget: SearchBudget,
): Promise<boolean> {
  const grams = gramsOf(term.text, 3);
  const posted = grams.length <= MAX_TERM_GRAMS && grams.length <= budget.left;
  const rows = posted ? grams : [UNPOSTED_GRAM];
  for (const gram of rows)
    await db.insert(TERM_GRAMS, {
      warehouseId: term.warehouseId,
      gram,
      termId: term._id,
      field: term.field,
      key: term.key,
      text: term.text,
    });
  budget.left -= rows.length;
  // A long term stays unposted for good; a budget deferral is retried later.
  return posted || grams.length > MAX_TERM_GRAMS;
}

async function unpostTerm(
  db: TenantDocumentAccess,
  termId: string,
  budget: SearchBudget,
) {
  for (;;) {
    const rows = await db
      .byIndex<TermGram>(TERM_GRAMS, "by_orgId_termId", [
        { field: "termId", value: termId },
      ])
      .take(100);
    for (const row of rows) await db.delete(TERM_GRAMS, row._id);
    budget.left -= rows.length;
    if (rows.length < 100) return;
  }
}

/**
 * Delete a scan-field term that no search row links any more, with its
 * term-level postings, so unused shared terms can neither grow storage nor
 * push a search past the shared-stream cap. Building-name terms follow their
 * building instead. Reads the term's slot range, so a concurrent writer that
 * links the term conflicts with this delete and retries.
 */
async function collectIfOrphaned(
  db: TenantDocumentAccess,
  termId: string,
  budget: SearchBudget,
): Promise<"kept" | "deleted" | "deferred"> {
  // Linked terms spend two read calls without consuming any write budget.
  // Limit checks independently so large shared-term deletes retain headroom.
  // Deferred work rechecks linkage in its own transaction.
  if (budget.left <= 0 || budget.orphanChecksLeft <= 0) return "deferred";
  budget.orphanChecksLeft -= 1;
  const term = await db.get<Term>(TERMS, termId);
  if (!term || term.field >= SLOTS.length) return "kept";
  const linked = await db
    .byIndex<SearchRow>(
      SEARCH_ROWS,
      `by_orgId_warehouseId_${SLOTS[term.field]}_createdAt`,
      [
        { field: "warehouseId", value: term.warehouseId },
        { field: SLOTS[term.field]!, value: term._id },
      ],
    )
    .take(1);
  if (linked.length) return "kept";
  const postings = term.shared
    ? Math.min(gramsOf(term.text, 3).length, MAX_TERM_GRAMS + 1)
    : 0;
  if (postings + 1 > budget.left) return "deferred";
  if (term.shared) await unpostTerm(db, term._id, budget);
  await db.delete(TERMS, term._id);
  budget.left -= 1;
  return "deleted";
}

/** Promote a term once more than `SHARED_AFTER` rows link it. */
async function promoteIfShared(
  db: TenantDocumentAccess,
  term: Term,
  budget: SearchBudget,
): Promise<{ shared: boolean; deferred: boolean }> {
  if (term.shared) return { shared: true, deferred: false };
  const linked = await db
    .byIndex<SearchRow>(
      SEARCH_ROWS,
      `by_orgId_warehouseId_${SLOTS[term.field]}_createdAt`,
      [
        { field: "warehouseId", value: term.warehouseId },
        { field: SLOTS[term.field]!, value: term._id },
      ],
    )
    .take(SHARED_AFTER + 1);
  if (linked.length <= SHARED_AFTER) return { shared: false, deferred: false };
  await db.patch(TERMS, term._id, { shared: true });
  budget.left -= 1;
  const complete = await postTerm(db, term, budget);
  return { shared: true, deferred: !complete };
}

/** Desired per-scan postings: gram → sorted texts; "" lists long texts. */
function scanPostings(texts: Iterable<string>) {
  const postings = new Map<string, Set<string>>();
  const add = (gram: string, text: string) => {
    let set = postings.get(gram);
    if (!set) postings.set(gram, (set = new Set()));
    set.add(text);
  };
  for (const text of texts) {
    const grams = gramsOf(text, 3);
    if (grams.length > MAX_TERM_GRAMS) add(UNPOSTED_GRAM, text);
    else for (const gram of grams) add(gram, text);
  }
  return new Map(
    [...postings].map(([gram, set]) => [gram, [...set].sort()] as const),
  );
}
const sameTexts = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((text, index) => text === b[index]);

/** All postings of one scan, in gram order (bounded by its texts' grams). */
async function existingScanGrams(db: TenantDocumentAccess, scanId: string) {
  const rows: ScanGram[] = [];
  for (;;) {
    const last = rows[rows.length - 1];
    const batch = await db
      .byIndex<ScanGram>(
        SCAN_GRAMS,
        "by_orgId_scanId_gram",
        [{ field: "scanId", value: scanId }],
        last
          ? { field: "gram", lower: { value: last.gram, inclusive: false } }
          : undefined,
      )
      .take(100);
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
}

/** Delete one deleted scan's postings within the budget; false if some remain. */
async function dropScanGrams(
  db: TenantDocumentAccess,
  scanId: string,
  budget: SearchBudget,
) {
  while (budget.left > 0) {
    const rows = await db
      .byIndex<ScanGram>(SCAN_GRAMS, "by_orgId_scanId_gram", [
        { field: "scanId", value: scanId },
      ])
      .take(Math.min(100, budget.left));
    for (const row of rows) await db.delete(SCAN_GRAMS, row._id);
    budget.left -= rows.length;
    if (rows.length < Math.min(100, budget.left + rows.length)) return true;
  }
  return false;
}

export interface SearchMaintenanceResult {
  /** Scans whose gram postings were deferred to an unposted row. */
  deferredScans: string[];
  /** Shared terms whose term postings were deferred. */
  deferredTerms: string[];
  /** Deleted scans whose leftover postings still need deleting. */
  orphanScans: string[];
}

/**
 * Bring the search rows and postings of these scans in line with their
 * current documents (deleted scans lose theirs). Idempotent; run inside the
 * transaction that wrote the scans, or by the backfill.
 */
export async function indexJobScans(
  db: TenantDocumentAccess,
  scanIds: Iterable<string>,
  budget: SearchBudget = searchBudget(),
  /** Rebuild postings even when the unshared texts look unchanged. */
  force = false,
): Promise<SearchMaintenanceResult> {
  const result: SearchMaintenanceResult = {
    deferredScans: [],
    deferredTerms: [],
    orphanScans: [],
  };
  const terms = termCache(db, budget);
  const zones = new Map<string, Promise<Doc<"storageZones"> | null>>();
  const zoneOf = (id: string) => {
    let found = zones.get(id);
    if (!found) zones.set(id, (found = db.get("storageZones", id)));
    return found;
  };
  const work: {
    scan: Scan;
    before: SearchRow | null;
    slots: (Term | undefined)[];
  }[] = [];
  // Terms a deleted or edited scan stopped linking: collected if unused.
  const released = new Set<string>();
  for (const scanId of new Set(scanIds)) {
    const [scan, before] = await Promise.all([
      db.get<Scan>("finishedGoodsJobScans", scanId),
      db
        .byIndex<SearchRow>(SEARCH_ROWS, "by_orgId_scanId", [
          { field: "scanId", value: scanId },
        ])
        .first(),
    ]);
    if (!scan) {
      if (before) {
        for (const slot of SLOTS) if (before[slot]) released.add(before[slot]);
        await db.delete(SEARCH_ROWS, before._id);
        budget.left -= 1;
      }
      if (!(await dropScanGrams(db, scanId, budget)))
        result.orphanScans.push(scanId);
      continue;
    }
    const slots = await Promise.all(
      JOB_SCAN_SEARCH_FIELDS.map((field, index) => {
        const text = searchableText(scan[field]);
        return text === undefined
          ? undefined
          : terms.resolve(scan.warehouseId, index, text);
      }),
    );
    const zone =
      scan.buildingId || !scan.zoneId ? null : await zoneOf(scan.zoneId);
    const buildingId = scan.buildingId ?? zone?.buildingId;
    const fields = {
      warehouseId: scan.warehouseId,
      scanId: scan._id,
      createdAt: scan.createdAt,
      scanCreationTime: scan._creationTime,
      mapped: scan.mapped,
      buildingId,
      ...Object.fromEntries(
        SLOTS.map((slot, index) => [slot, slots[index]?._id]),
      ),
      sourceHash: await scanSourceHash(scan),
    };
    if (before)
      for (const [index, slot] of SLOTS.entries())
        if (before[slot] && before[slot] !== slots[index]?._id)
          released.add(before[slot]);
    if (!before)
      await db.insert(
        SEARCH_ROWS,
        Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== undefined),
        ),
      );
    else if (
      Object.entries(fields).some(
        ([field, value]) => before[field as keyof SearchRow] !== value,
      )
    )
      await db.patch(SEARCH_ROWS, before._id, fields);
    budget.left -= 1;
    work.push({ scan, before, slots });
  }
  // Shared status after this transaction's links (reads see its own writes).
  const status = new Map<string, boolean>();
  for (const { slots } of work)
    for (const term of slots) {
      if (!term || status.has(term._id)) continue;
      const promoted = await promoteIfShared(db, term, budget);
      status.set(term._id, promoted.shared);
      if (promoted.deferred) result.deferredTerms.push(term._id);
    }
  for (const { scan, before, slots } of work) {
    const unshared = (list: readonly (Term | null | undefined)[]) =>
      new Set(
        list
          .filter(
            (term): term is Term =>
              term !== null &&
              term !== undefined &&
              !(status.get(term._id) ?? term.shared),
          )
          .map((term) => term.text),
      );
    const next = unshared(slots);
    if (before && !force) {
      const previous = unshared(
        await Promise.all(
          SLOTS.map((slot) => (before[slot] ? terms.get(before[slot]) : null)),
        ),
      );
      // Same unshared texts: existing postings are already exact.
      if (
        previous.size === next.size &&
        [...next].every((text) => previous.has(text))
      )
        continue;
    }
    const desired = scanPostings(next);
    const key = {
      warehouseId: scan.warehouseId,
      createdAt: scan.createdAt,
      scanCreationTime: scan._creationTime,
      scanId: scan._id,
    };
    // Defer: one unposted row lists every unshared text, so the scan stays
    // findable; stale extra rows only add candidates. Re-indexed later.
    const defer = async (unposted: ScanGram | null | undefined) => {
      const texts = [...next].sort();
      if (!unposted && texts.length)
        await db.insert(SCAN_GRAMS, { ...key, gram: UNPOSTED_GRAM, texts });
      else if (unposted && !sameTexts(unposted.texts, texts))
        await db.patch(SCAN_GRAMS, unposted._id, { texts });
      budget.left -= 1;
      result.deferredScans.push(scan._id);
    };
    // A spent budget defers without reading the scan's postings at all.
    if (budget.left <= 0 && (desired.size || before || force)) {
      await defer(
        await db
          .byIndex<ScanGram>(SCAN_GRAMS, "by_orgId_scanId_gram", [
            { field: "scanId", value: scan._id },
            { field: "gram", value: UNPOSTED_GRAM },
          ])
          .first(),
      );
      continue;
    }
    const existing =
      before || force ? await existingScanGrams(db, scan._id) : [];
    const current = new Map(existing.map((row) => [row.gram, row] as const));
    const changes =
      existing.filter(
        (row) =>
          !desired.has(row.gram) ||
          !sameTexts(row.texts, desired.get(row.gram)!),
      ).length +
      [...desired.keys()].filter((gram) => !current.has(gram)).length;
    if (changes > budget.left) {
      await defer(current.get(UNPOSTED_GRAM));
      continue;
    }
    for (const row of existing) {
      const texts = desired.get(row.gram);
      if (!texts) await db.delete(SCAN_GRAMS, row._id);
      else if (!sameTexts(row.texts, texts))
        await db.patch(SCAN_GRAMS, row._id, { texts });
    }
    for (const [gram, texts] of desired)
      if (!current.has(gram))
        await db.insert(SCAN_GRAMS, { ...key, gram, texts });
    budget.left -= changes;
  }
  for (const termId of released)
    if ((await collectIfOrphaned(db, termId, budget)) === "deferred")
      result.deferredTerms.push(termId);
  return result;
}

/** Re-post deferred shared terms (unposted row → trigram rows). */
export async function repostJobScanTerms(
  db: TenantDocumentAccess,
  termIds: Iterable<string>,
  budget: SearchBudget = searchBudget(),
) {
  const deferred: string[] = [];
  for (const termId of new Set(termIds)) {
    const collected = await collectIfOrphaned(db, termId, budget);
    if (collected === "deferred") {
      deferred.push(termId);
      continue;
    }
    const term =
      collected === "deleted" ? null : await db.get<Term>(TERMS, termId);
    if (!term) {
      await unpostTerm(db, termId, budget);
      continue;
    }
    if (!term.shared) continue;
    const grams = gramsOf(term.text, 3);
    if (grams.length > MAX_TERM_GRAMS) continue;
    if (grams.length + 1 > budget.left) {
      deferred.push(termId);
      continue;
    }
    await unpostTerm(db, termId, budget);
    await postTerm(db, term, budget);
  }
  return deferred;
}

/**
 * Keep the building-name term of each building current. `warehouseId` is the
 * building's warehouse before the write (a deleted building has no other).
 */
export async function indexBuildingNames(
  db: TenantDocumentAccess,
  buildings: Iterable<{ buildingId: string; warehouseIds: Iterable<string> }>,
  budget: SearchBudget = searchBudget(),
) {
  const deferredTerms: string[] = [];
  for (const { buildingId, warehouseIds } of buildings) {
    const building = await db.get<Doc<"storageBuildings">>(
      "storageBuildings",
      buildingId,
    );
    const warehouses = new Set(warehouseIds);
    if (building) warehouses.add(building.warehouseId);
    for (const warehouseId of warehouses) {
      const text =
        building && building.warehouseId === warehouseId
          ? searchableText(building.name)
          : undefined;
      const existing = await db
        .byIndex<Term>(TERMS, "by_orgId_warehouseId_field_key", [
          { field: "warehouseId", value: warehouseId },
          { field: "field", value: BUILDING_FIELD },
          { field: "key", value: buildingId },
        ])
        .first();
      if (existing && existing.text === text) continue;
      if (existing) {
        await unpostTerm(db, existing._id, budget);
        await db.delete(TERMS, existing._id);
        budget.left -= 1;
      }
      if (text === undefined) continue;
      const id = await db.insert(TERMS, {
        warehouseId,
        field: BUILDING_FIELD,
        key: buildingId,
        text,
        shared: true,
      });
      budget.left -= 1;
      if (!(await postTerm(db, (await db.get<Term>(TERMS, id))!, budget)))
        deferredTerms.push(id);
    }
  }
  return deferredTerms;
}

// ---------------------------------------------------------------------------
// Query

/** Newest-first position: createdAt, scan creation time, scan ID. */
type Key = readonly [number, number, string];
/** Negative when `a` is shown before `b`. */
function order(a: Key, b: Key) {
  return b[0] - a[0] || b[1] - a[1] || (a[2] < b[2] ? 1 : a[2] > b[2] ? -1 : 0);
}

interface Source<T> {
  readonly table: TenantTableName;
  readonly index: string;
  readonly equality: TenantIndexEquality;
  readonly timeField: string;
  readonly key: (row: T) => Key;
  /** False drops the row before any scan read (a pre-filter, never a match). */
  readonly propose: (row: T) => boolean;
  /** The scan itself when the stream reads scans. */
  readonly scan?: (row: T) => Scan;
}

/** Candidates in newest-first key order, read a chunk at a time. */
interface CandidateStream {
  buffer: { key: Key; scan?: Scan }[];
  done: boolean;
  fill(): Promise<number>;
}

class Stream<T> implements CandidateStream {
  buffer: { key: Key; scan?: Scan }[] = [];
  done = false;
  private position: Key | null;
  constructor(
    private readonly db: TenantDocumentAccess,
    private readonly source: Source<T>,
    start: Key | null,
    private chunk: number,
  ) {
    this.position = start;
  }
  /** Read the next chunk after the stream position; returns rows read. */
  async fill() {
    const { db, source } = this;
    const limit = Math.min(100, Math.max(2, this.chunk));
    this.chunk = Math.min(100, this.chunk * 2);
    const reader = (equality: TenantIndexEquality, upper?: [string, number]) =>
      db
        .byIndex<T & TenantOwnedDocument>(
          source.table,
          source.index,
          equality,
          upper
            ? {
                field: upper[0],
                upper: { value: upper[1], inclusive: upper[0] !== "createdAt" },
              }
            : undefined,
        )
        .take(limit, "desc");
    const position = this.position;
    let rows: T[];
    let raw: number;
    if (!position) {
      rows = [...(await reader(source.equality))];
      raw = rows.length;
    } else {
      // Rest of the boundary's createdAt (ties by ID), then older ones.
      const same = await reader(
        [...source.equality, { field: "createdAt", value: position[0] }],
        [source.timeField, position[1]],
      );
      rows = same.filter((row) => order(source.key(row), position) > 0);
      raw = same.length;
      if (raw < limit) {
        const older = await reader(source.equality, ["createdAt", position[0]]);
        rows.push(...older);
        raw += older.length;
      }
    }
    if (raw < limit) this.done = true;
    if (rows.length) this.position = source.key(rows[rows.length - 1]!);
    for (const row of rows)
      if (source.propose(row))
        this.buffer.push({
          key: source.key(row),
          ...(source.scan ? { scan: source.scan(row) } : {}),
        });
    return raw;
  }
}

export interface JobScanSearchOptions<Row> {
  warehouseId: Id<"warehouses">;
  /** The warehouse's current readiness row (`jobScanSearchIndex`). */
  readiness: CurrentSearchReadiness;
  filter: "ALL" | "MAPPED" | "UNMAPPED";
  needle: string;
  pageSize: number;
  cursor?: string | null | undefined;
  scanCursor?: string | undefined;
  progressive: boolean;
  /** The exact predicate of the scan path (warehouse, filter, text, building). */
  accept: (scan: Scan) => Promise<boolean>;
  hydrate: (scans: Scan[]) => Promise<Row[]>;
}

/** Can the index answer this needle? Shorter needles keep the bounded scan. */
export function indexableNeedle(needle: string) {
  return codePointLength(needle) >= MIN_INDEXED_NEEDLE && isWellFormed(needle);
}

type CursorState = {
  v: "jss1";
  k: "page" | "scan";
  scope: string;
  /** Last examined position (null: from the newest record). */
  pos: Key | null;
  /** Page continuation: accepted IDs collected so far. */
  ids: string[];
  /** Stable gram choices for this traversal. */
  g?: string;
  h?: string;
};
const MAX_WORK = 400;
const MAX_PROBES = 6;
const SCAN_PROBE = 8;
const TERM_PROBE = 16;
/** One bounded read (the tenant reader's maximum is 100 rows). */
const TERM_LIMIT = 99;
const STREAM_CAP = 48;
const DOCUMENT_ID = /^[0-9A-Za-z_]{1,64}$/;

function decodeState(
  value: string,
  scope: string,
  kind: CursorState["k"],
  pageSize: number,
  grams: ReadonlySet<string>,
): CursorState | null {
  if (value.length > 16_384) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const state = parsed as Partial<CursorState>;
  const pos = state.pos;
  const validPos =
    pos === null ||
    (Array.isArray(pos) &&
      pos.length === 3 &&
      Number.isFinite(pos[0]) &&
      Number.isFinite(pos[1]) &&
      typeof pos[2] === "string" &&
      DOCUMENT_ID.test(pos[2]));
  const ids = state.ids;
  if (
    state.v !== "jss1" ||
    state.k !== kind ||
    state.scope !== scope ||
    !validPos ||
    !Array.isArray(ids) ||
    ids.length > (kind === "page" ? 0 : pageSize - 1) ||
    !ids.every((id) => typeof id === "string" && DOCUMENT_ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    (kind === "page" && pos === null) ||
    (state.g !== undefined && !grams.has(state.g)) ||
    (state.h !== undefined && !grams.has(state.h))
  )
    return null;
  return state as CursorState;
}

const reset = <Row>(): BoundedRecordPage<Row> => ({
  status: "reset",
  items: [],
  isDone: true,
  continueCursor: "",
  scanned: 0,
});

export async function searchJobScans<Row>(
  ctx: TenantFunctionContext,
  options: JobScanSearchOptions<Row>,
): Promise<BoundedRecordPage<Row>> {
  const db = ctx.tenantDb;
  const { warehouseId, filter, needle, pageSize } = options;
  const scope = catalogueScope(ctx, [
    "finishedGoodsJobScans:search",
    warehouseId,
    filter,
    needle,
    pageSize,
  ]);
  const allGrams = new Set(gramsOf(needle, 3));
  let state: CursorState = { v: "jss1", k: "page", scope, pos: null, ids: [] };
  if (options.scanCursor) {
    const decoded = options.progressive
      ? decodeState(options.scanCursor, scope, "scan", pageSize, allGrams)
      : null;
    if (!decoded) return reset();
    state = decoded;
  } else if (options.cursor) {
    const decoded = decodeState(
      options.cursor,
      scope,
      "page",
      pageSize,
      allGrams,
    );
    if (!decoded) return reset();
    state = decoded;
  }
  let work = 0;
  const take = async <T>(
    table: TenantTableName,
    index: string,
    equality: TenantIndexEquality,
    limit: number,
  ) => {
    const rows = await db
      .byIndex<T & TenantOwnedDocument>(table, index, equality)
      .take(limit, "desc");
    work += rows.length;
    return rows as unknown as T[];
  };
  const wh = { field: "warehouseId", value: warehouseId } as const;

  // A layout write that did not maintain the index moved the layout counter
  // without it: building names come from history then (same order, same
  // cursors). Job scans written by code that does not maintain the index are
  // re-indexed by `reconcile` (lib/searchReadiness.ts); readers do not pay
  // for that guard on every search.
  const generation = await layoutGeneration(db, warehouseId);
  work += 1;
  let exhaustive = generation !== options.readiness.layoutGeneration;

  // Shared terms containing the needle: through their rarest gram.
  const probes = probeGrams(needle, 3, MAX_PROBES);
  let termGram = state.h;
  const matchingTerms = new Map<string, TermGram>();
  if (!exhaustive) {
    let termRows: TermGram[] | null = null;
    if (!termGram) {
      const sampled = await Promise.all(
        probes.map((gram) =>
          take<TermGram>(
            TERM_GRAMS,
            "by_orgId_warehouseId_gram",
            [wh, { field: "gram", value: gram }],
            TERM_PROBE + 1,
          ),
        ),
      );
      let best = 0;
      for (let index = 1; index < probes.length; index++)
        if (sampled[index]!.length < sampled[best]!.length) best = index;
      termGram = probes[best]!;
      if (sampled[best]!.length <= TERM_PROBE) termRows = sampled[best]!;
    }
    termRows ??= await take<TermGram>(
      TERM_GRAMS,
      "by_orgId_warehouseId_gram",
      [wh, { field: "gram", value: termGram }],
      TERM_LIMIT + 1,
    );
    const unpostedTerms = await take<TermGram>(
      TERM_GRAMS,
      "by_orgId_warehouseId_gram",
      [wh, { field: "gram", value: UNPOSTED_GRAM }],
      TERM_LIMIT + 1,
    );
    for (const row of [...termRows, ...unpostedTerms])
      if (row.text.includes(needle)) matchingTerms.set(row.termId, row);
    exhaustive =
      termRows.length > TERM_LIMIT ||
      unpostedTerms.length > TERM_LIMIT ||
      matchingTerms.size > STREAM_CAP;
  }

  // Per-scan postings: the gram whose postings are fewest (or sparsest).
  // Not needed when the history merge answers (too many shared terms).
  let scanGram = state.g;
  if (!scanGram && !exhaustive) {
    const sampled = await Promise.all(
      probes.map((gram) =>
        take<ScanGram>(
          SCAN_GRAMS,
          "by_orgId_warehouseId_gram_createdAt",
          [wh, { field: "gram", value: gram }],
          SCAN_PROBE,
        ),
      ),
    );
    let best = 0;
    // Exhausted grams by count; otherwise the one reaching furthest back.
    const rank = (rows: ScanGram[]) =>
      rows.length < SCAN_PROBE
        ? [0, rows.length]
        : [1, rows[rows.length - 1]!.createdAt];
    for (let index = 1; index < probes.length; index++) {
      const [a0, a1] = rank(sampled[index]!);
      const [b0, b1] = rank(sampled[best]!);
      if (a0! < b0! || (a0 === b0 && a1! < b1!)) best = index;
    }
    scanGram = probes[best]!;
  }
  const start = state.pos;
  const scanKey = (row: Scan): Key => [
    row.createdAt,
    row._creationTime,
    row._id,
  ];
  const rowKey = (row: {
    createdAt: number;
    scanCreationTime: number;
    scanId: string;
  }): Key => [row.createdAt, row.scanCreationTime, row.scanId];
  const mappedOk = (row: SearchRow) =>
    filter === "ALL" || row.mapped === (filter === "MAPPED");
  const textOk = (row: ScanGram) =>
    row.texts.some((text) => text.includes(needle));
  const streams: CandidateStream[] = [];
  const add = <T>(source: Source<T>, chunk: number) =>
    streams.push(new Stream<T>(db, source, start, chunk));
  if (exhaustive) {
    // Too many matching terms to merge: scan history in key order, exactly
    // as the unindexed path does, keeping this traversal's cursor format.
    add<Scan>(
      {
        table: "finishedGoodsJobScans",
        index:
          filter === "ALL"
            ? "by_orgId_warehouseId_createdAt"
            : "by_orgId_warehouseId_mapped_createdAt",
        equality:
          filter === "ALL"
            ? [wh]
            : [wh, { field: "mapped", value: filter === "MAPPED" }],
        timeField: TENANT_INDEX_TIEBREAKER,
        key: scanKey,
        propose: () => true,
        scan: (row) => row,
      },
      100,
    );
  } else {
    for (const gram of [scanGram, UNPOSTED_GRAM])
      add<ScanGram>(
        {
          table: SCAN_GRAMS,
          index: "by_orgId_warehouseId_gram_createdAt",
          equality: [wh, { field: "gram", value: gram }],
          timeField: "scanCreationTime",
          key: rowKey,
          propose: textOk,
        },
        gram === UNPOSTED_GRAM ? 8 : pageSize + 1,
      );
    const perTerm =
      Math.ceil((pageSize + 1) / Math.max(1, matchingTerms.size)) + 1;
    for (const term of matchingTerms.values())
      add<SearchRow>(
        {
          table: SEARCH_ROWS,
          index:
            term.field === BUILDING_FIELD
              ? "by_orgId_warehouseId_buildingId_createdAt"
              : `by_orgId_warehouseId_${SLOTS[term.field]}_createdAt`,
          equality: [
            wh,
            term.field === BUILDING_FIELD
              ? { field: "buildingId", value: term.key }
              : { field: SLOTS[term.field]!, value: term.termId },
          ],
          timeField: "scanCreationTime",
          key: rowKey,
          propose: mappedOk,
        },
        perTerm,
      );
  }

  // Merge newest first; equal keys are one scan proposed by several streams.
  // Every request examines at least one candidate, so a scan always advances.
  let progressed = false;
  const next = async (): Promise<
    { key: Key; scan?: Scan } | "budget" | null
  > => {
    for (;;) {
      const empty = streams.filter((s) => !s.done && s.buffer.length === 0);
      if (!empty.length) break;
      if (progressed && work >= MAX_WORK) return "budget";
      for (const read of await Promise.all(empty.map((s) => s.fill())))
        work += read;
    }
    let best: { key: Key; scan?: Scan } | undefined;
    for (const stream of streams) {
      const head = stream.buffer[0];
      if (head && (!best || order(head.key, best.key) < 0)) best = head;
    }
    if (!best) return null;
    for (const stream of streams)
      if (stream.buffer[0] && order(stream.buffer[0].key, best.key) === 0)
        stream.buffer.shift();
    return best;
  };

  const page: Scan[] = [];
  for (const scan of await Promise.all(
    state.ids.map((id) => db.get<Scan>("finishedGoodsJobScans", id)),
  )) {
    work += 1;
    if (scan && (await options.accept(scan))) page.push(scan);
  }
  let scanned = 0;
  let pos = start;
  let lastShown: Key | null = null;
  let outcome: "full" | "exhausted" | "budget" = "budget";
  for (;;) {
    if (progressed && work >= MAX_WORK) break;
    const candidate = await next();
    if (candidate === "budget") break;
    if (candidate === null) {
      outcome = "exhausted";
      break;
    }
    let scan = candidate.scan;
    if (!scan) {
      scan =
        (await db.get<Scan>("finishedGoodsJobScans", candidate.key[2])) ??
        undefined;
      work += 1;
    }
    scanned += 1;
    progressed = true;
    if (scan && (await options.accept(scan))) {
      if (page.length >= pageSize) {
        outcome = "full";
        break;
      }
      page.push(scan);
      lastShown = candidate.key;
    }
    pos = candidate.key;
  }
  const encode = (next: Omit<CursorState, "v" | "scope" | "g" | "h">) =>
    JSON.stringify({
      v: "jss1",
      scope,
      ...next,
      ...(scanGram ? { g: scanGram } : {}),
      ...(termGram ? { h: termGram } : {}),
    } satisfies CursorState);
  if (page.length < pageSize && outcome === "budget") {
    if (!options.progressive)
      return {
        status: "ready",
        items: await options.hydrate(page),
        isDone: false,
        scanned,
        continueCursor: encode({ k: "page", pos: pos ?? start, ids: [] }),
      };
    return {
      status: "scanning",
      items: await options.hydrate(page),
      isDone: false,
      continueCursor: "",
      scanCursor: encode({ k: "scan", pos, ids: page.map((scan) => scan._id) }),
      scanned,
    };
  }
  const isDone = outcome === "exhausted";
  // The next page starts after the last row shown (or examined, when the
  // page was filled by retained rows only).
  const resume =
    lastShown ?? (page.length ? scanKey(page[page.length - 1]!) : pos);
  return {
    status: "ready",
    items: await options.hydrate(page),
    isDone,
    scanned,
    continueCursor:
      isDone || !resume ? "" : encode({ k: "page", pos: resume, ids: [] }),
  };
}
