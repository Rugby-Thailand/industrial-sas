import { decodeBucketKey } from "../../../convex/model/inventory/stockIdentity";

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

  readonly value: string;
}

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
