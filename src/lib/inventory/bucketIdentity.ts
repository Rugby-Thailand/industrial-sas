/**
 * What tells one stock bucket from another, for a screen.
 *
 * A balance row is keyed by `encodeBucketKey`: nine dimensions, each
 * length-prefixed, joined into one string that is deliberately not for reading
 * (`convex/model/inventory/stockIdentity.ts`). The balances table used to render
 * that string abbreviated at both ends, and the abbreviation collapsed: every
 * key of one tenant starts with the same organization prefix and ends with its
 * stock status, so `IB1|3:prv…9:AVAILABLE` was what several different buckets
 * showed. The two halves kept were the two halves that never differ.
 *
 * So the key is decoded instead, with the real decoder — the left inverse of the
 * encoder, so what a screen shows is what the key says, and a decoder that
 * drifted from the encoder would fail that module's own property test rather
 * than mislabel a warehouse screen.
 *
 * ### Which dimensions come back
 *
 * Item, location, lot, serial, handling unit, owner: the dimensions on which two
 * rows of one balances screen can differ. Organization and warehouse are omitted
 * because the screen is already scoped to one of each — every row would carry
 * the same two values, which is noise in a cell whose whole job is to
 * distinguish. Stock status is omitted because it has its own column.
 *
 * A virtual boundary is reported as its own dimension rather than as a location.
 * The supplier's side of a receipt is a counterparty, not a place anybody walks
 * to (`G-023`), and labelling `SUPPLIER_RECEIPT` "Location" would say otherwise.
 *
 * Pure and total: an unparseable key answers no parts at all, and the caller
 * shows the key itself. Nothing here throws and nothing here formats.
 */
import { decodeBucketKey } from "../../../convex/model/inventory/stockIdentity";

/** A dimension of a bucket, as a screen names it. */
export type BucketDimension =
  | "item"
  | "location"
  | "boundary"
  | "lot"
  | "serial"
  | "handlingUnit"
  | "owner";

export interface BucketPart {
  readonly dimension: BucketDimension;
  /** The identifier or code stored in that dimension. Never abbreviated. */
  readonly value: string;
}

/**
 * The distinguishing dimensions of a bucket key, in reading order.
 *
 * Empty exactly when the key cannot be decoded: a valid bucket always has an
 * item and a location, so an empty answer is never "this bucket has no
 * dimensions".
 */
export function describeBucketKey(bucketKey: string): readonly BucketPart[] {
  const decoded = decodeBucketKey(bucketKey);
  if (!decoded.ok) return Object.freeze([]);

  const bucket = decoded.value;
  const location = bucket.location;

  const optional = (
    dimension: BucketDimension,
    value: string | undefined,
  ): readonly BucketPart[] =>
    value === undefined ? [] : [Object.freeze({ dimension, value })];

  return Object.freeze([
    Object.freeze({ dimension: "item" as const, value: bucket.itemId }),
    location.kind === "PHYSICAL"
      ? Object.freeze({
          dimension: "location" as const,
          value: location.locationId,
        })
      : Object.freeze({
          dimension: "boundary" as const,
          value: location.boundary,
        }),
    ...optional("lot", bucket.lotId),
    ...optional("serial", bucket.serialId),
    ...optional("handlingUnit", bucket.handlingUnitId),
    ...optional("owner", bucket.ownerId),
  ]);
}
