import type { Doc } from "../_generated/dataModel";
import type { TenantDocumentAccess } from "./tenantDb";
import {
  codePointLength,
  gramsOf,
  isWellFormed,
  UNPOSTED_GRAM,
} from "./textGrams";
import type { SearchBudget } from "./jobScanSearch";

/**
 * Exact, index-backed contains search for the job-scan location picker.
 *
 * The picker matches a location when the NFC/upper-cased code or label of its
 * match source contains the needle: a named registration's own code and
 * label, otherwise the first support position (or area) attached to the
 * location row. Each location keeps bigram postings of those texts, keyed in
 * location-code order, so the picker can walk only the locations sharing the
 * needle's rarest bigram in exactly the order (and prefix-first phases) it
 * walks all locations today. Postings only propose rows: the picker re-reads
 * every proposed location and applies its unchanged predicate.
 *
 * Writers keep postings exact in their own transaction (tracked tenant
 * writes); readers use them only while the warehouse's readiness row is ready.
 */
export const LOCATION_SEARCH_VERSION = 1;
export const MIN_INDEXED_LOCATION_NEEDLE = 2;
const GRAMS = "locationSearchGrams";
const MAX_TEXT_GRAMS = 512;

type Posting = Doc<"locationSearchGrams">;

/** Case-insensitive search text with the same normalization as registered codes. */
export function normalizeLocationSearch(raw: string) {
  return raw.trim().normalize("NFC").toUpperCase();
}
/** The picker's comparison text for one stored code or label. */
export const locationMatchText = (text: string) =>
  text.normalize("NFC").toUpperCase();

export function indexableLocationNeedle(needle: string) {
  return (
    codePointLength(needle) >= MIN_INDEXED_LOCATION_NEEDLE &&
    isWellFormed(needle)
  );
}

export async function locationSearchReady(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
) {
  const row = await db
    .byIndex<Doc<"searchIndexReadiness">>(
      "searchIndexReadiness",
      "by_orgId_warehouseId_kind",
      [
        { field: "warehouseId", value: warehouseId },
        { field: "kind", value: "locations" },
      ],
    )
    .unique();
  return (
    row?.ready === true &&
    row.stale !== true &&
    row.version === LOCATION_SEARCH_VERSION
  );
}

/** Raw code/label texts the picker compares for this location row, if any. */
export async function locationSourceTexts(
  db: Pick<TenantDocumentAccess, "byIndex">,
  row: Doc<"locations">,
): Promise<string[]> {
  if (row.locationType === "NAMED_STORAGE")
    return [row.code, row.label ?? row.code];
  const position = await db
    .byIndex<Doc<"storagePositions">>(
      "storagePositions",
      "by_orgId_locationId",
      [{ field: "locationId", value: row._id }],
    )
    .first();
  if (position) return [position.code, position.label];
  const zone = await db
    .byIndex<Doc<"storageZones">>("storageZones", "by_orgId_locationId", [
      { field: "locationId", value: row._id },
    ])
    .first();
  return zone ? [zone.code, zone.label] : [];
}

/**
 * gram → sorted texts. A location with an unposted row ("") is represented by
 * that row alone (it lists every text), and the picker ignores its other rows.
 */
function postingsOf(texts: readonly string[]) {
  const all = [
    ...new Set(
      texts
        .map(locationMatchText)
        .filter((text) => codePointLength(text) >= MIN_INDEXED_LOCATION_NEEDLE),
    ),
  ].sort();
  const grams = all.map((text) => gramsOf(text, 2));
  if (grams.some((list) => list.length > MAX_TEXT_GRAMS))
    return new Map([[UNPOSTED_GRAM, all]]);
  const postings = new Map<string, Set<string>>();
  for (const [index, list] of grams.entries())
    for (const gram of list) {
      let set = postings.get(gram);
      if (!set) postings.set(gram, (set = new Set()));
      set.add(all[index]!);
    }
  return new Map(
    [...postings].map(([gram, set]) => [gram, [...set].sort()] as const),
  );
}

/** The unposted row of a location, which supersedes its gram rows. */
export async function unpostedLocation(
  db: Pick<TenantDocumentAccess, "byIndex">,
  locationId: string,
) {
  return db
    .byIndex<Posting>(GRAMS, "by_orgId_locationId_gram", [
      { field: "locationId", value: locationId },
      { field: "gram", value: UNPOSTED_GRAM },
    ])
    .first();
}

async function existingPostings(db: TenantDocumentAccess, locationId: string) {
  const rows: Posting[] = [];
  for (;;) {
    const last = rows[rows.length - 1];
    const batch = await db
      .byIndex<Posting>(
        GRAMS,
        "by_orgId_locationId_gram",
        [{ field: "locationId", value: locationId }],
        last
          ? { field: "gram", lower: { value: last.gram, inclusive: false } }
          : undefined,
      )
      .take(100);
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
}

const sameTexts = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((text, index) => text === b[index]);

/**
 * Bring the postings of these locations in line with their rows and match
 * sources. Over the budget, a location gets one unposted row (always a
 * candidate) and is returned for re-indexing.
 */
export async function indexLocations(
  db: TenantDocumentAccess,
  locationIds: Iterable<string>,
  budget: SearchBudget,
): Promise<string[]> {
  const deferred: string[] = [];
  for (const locationId of new Set(locationIds)) {
    if (budget.left <= 0) {
      // A spent budget defers without reading the location's postings.
      const row = await db.get<Doc<"locations">>("locations", locationId);
      if (row) {
        const texts = await locationSourceTexts(db, row);
        const fields = {
          warehouseId: row.warehouseId,
          code: row.code,
          texts: [...new Set(texts.map(locationMatchText))].sort(),
        };
        const unposted = await unpostedLocation(db, locationId);
        if (unposted) await db.patch(GRAMS, unposted._id, fields);
        else
          await db.insert(GRAMS, {
            ...fields,
            gram: UNPOSTED_GRAM,
            locationId,
          });
        budget.left -= 1;
      }
      deferred.push(locationId);
      continue;
    }
    const [row, existing] = await Promise.all([
      db.get<Doc<"locations">>("locations", locationId),
      existingPostings(db, locationId),
    ]);
    const texts = row ? await locationSourceTexts(db, row) : [];
    const desired = row ? postingsOf(texts) : new Map<string, string[]>();
    const current = new Map(existing.map((posting) => [posting.gram, posting]));
    const stale = (posting: Posting) =>
      !desired.has(posting.gram) ||
      posting.code !== row!.code ||
      posting.warehouseId !== row!.warehouseId ||
      !sameTexts(posting.texts, desired.get(posting.gram)!);
    const changes =
      existing.filter(stale).length +
      [...desired.keys()].filter((gram) => !current.has(gram)).length;
    if (!changes) continue;
    if (!row && changes > budget.left) {
      // Leftover postings of a deleted row only propose a row that no longer
      // exists; they are removed by the re-index job.
      deferred.push(locationId);
      continue;
    }
    if (row && changes > budget.left) {
      // Defer: the unposted row (current code, every text) represents the
      // location; its older gram rows are ignored by the picker until then.
      const all = [...new Set(texts.map(locationMatchText))].sort();
      const unposted = current.get(UNPOSTED_GRAM);
      const fields = {
        warehouseId: row.warehouseId,
        code: row.code,
        texts: all,
      };
      if (!unposted)
        await db.insert(GRAMS, {
          ...fields,
          gram: UNPOSTED_GRAM,
          locationId,
        });
      else await db.patch(GRAMS, unposted._id, fields);
      budget.left -= 1;
      deferred.push(locationId);
      continue;
    }
    for (const posting of existing) {
      const wanted = desired.get(posting.gram);
      if (!wanted) await db.delete(GRAMS, posting._id);
      else if (stale(posting))
        await db.patch(GRAMS, posting._id, {
          warehouseId: row!.warehouseId,
          code: row!.code,
          texts: wanted,
        });
    }
    for (const [gram, wanted] of desired)
      if (!current.has(gram))
        await db.insert(GRAMS, {
          warehouseId: row!.warehouseId,
          gram,
          code: row!.code,
          locationId,
          texts: wanted,
        });
    budget.left -= changes;
  }
  return deferred;
}
