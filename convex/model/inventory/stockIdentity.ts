import { frozenArray, isRecord, isString, recordValue } from "../guards";
import { fail, ok, type Result } from "../result";

export const STOCK_STATUSES = [
  "AVAILABLE",
  "QC_HOLD",
  "QUARANTINE",
  "REJECTED",
  "SCRAP",
  "EXPIRED",
] as const;

export type StockStatus = (typeof STOCK_STATUSES)[number];

export const isStockStatus = (value: unknown): value is StockStatus =>
  isString(value) && (STOCK_STATUSES as readonly string[]).includes(value);

export const isAvailableStatus = (status: StockStatus): boolean =>
  status === "AVAILABLE";

export type BoundaryFlow = "SOURCE" | "SINK" | "BOTH";

export interface VirtualBoundary {
  readonly code: string;
  readonly flow: BoundaryFlow;

  readonly purpose: string;
}

const boundary = (
  code: string,
  flow: BoundaryFlow,
  purpose: string,
): VirtualBoundary => Object.freeze({ code, flow, purpose });

export const VIRTUAL_BOUNDARIES: Readonly<Record<string, VirtualBoundary>> =
  Object.freeze(
    Object.assign(Object.create(null) as Record<string, VirtualBoundary>, {
      SUPPLIER_RECEIPT: boundary(
        "SUPPLIER_RECEIPT",
        "SOURCE",
        "Stock arriving from a supplier against a purchase order or a blind receipt.",
      ),
      CUSTOMER_SHIPMENT: boundary(
        "CUSTOMER_SHIPMENT",
        "SINK",
        "Stock leaving the warehouse to a customer.",
      ),
      CUSTOMER_RETURN: boundary(
        "CUSTOMER_RETURN",
        "SOURCE",
        "Stock returning from a customer or failed delivery into warehouse control.",
      ),
      PRODUCTION_ISSUE: boundary(
        "PRODUCTION_ISSUE",
        "SINK",
        "Material issued to a production order.",
      ),
      PRODUCTION_RECEIPT: boundary(
        "PRODUCTION_RECEIPT",
        "SOURCE",
        "Finished or semi-finished output received from production.",
      ),
      INVENTORY_ADJUSTMENT: boundary(
        "INVENTORY_ADJUSTMENT",
        "BOTH",
        "Counterparty for a counted adjustment, in either direction.",
      ),
      SCRAP_DAMAGE: boundary(
        "SCRAP_DAMAGE",
        "SINK",
        "Stock destroyed, scrapped, or written off as damaged.",
      ),
      RECONCILIATION: boundary(
        "RECONCILIATION",
        "BOTH",
        "Counterparty for an operator-authorized correction raised by ledger reconciliation.",
      ),
      TRANSFER_IN_TRANSIT: boundary(
        "TRANSFER_IN_TRANSIT",
        "BOTH",
        "Stock dispatched by one warehouse and not yet accepted or returned through the transfer aggregate.",
      ),
    }),
  );

export type VirtualBoundaryCode = keyof typeof VIRTUAL_BOUNDARIES & string;

export const virtualBoundaryCodes = (): readonly string[] =>
  frozenArray(Object.keys(VIRTUAL_BOUNDARIES).sort());

export const virtualBoundaryByCode = (code: string): VirtualBoundary | null =>
  isString(code) ? recordValue(VIRTUAL_BOUNDARIES, code) : null;

export interface PhysicalLocation {
  readonly kind: "PHYSICAL";
  readonly locationId: string;
}

export interface VirtualLocation {
  readonly kind: "VIRTUAL";
  readonly boundary: VirtualBoundaryCode;
}

export type LedgerLocation = PhysicalLocation | VirtualLocation;

export interface InventoryBucket {
  readonly orgId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly location: LedgerLocation;
  readonly lotId?: string | undefined;
  readonly serialId?: string | undefined;
  readonly handlingUnitId?: string | undefined;
  readonly ownerId?: string | undefined;
  readonly stockStatus: StockStatus;
}

export type BucketError =
  | {
      readonly code: "NOT_A_BUCKET";
      readonly received: string;
    }
  | {
      readonly code: "MISSING_COMPONENT";
      readonly component: string;
    }
  | {
      readonly code: "INVALID_COMPONENT";
      readonly component: string;
      readonly received: string;
    }
  | {
      readonly code: "COMPONENT_TOO_LONG";
      readonly component: string;
      readonly length: number;
      readonly limit: number;
    }
  | {
      readonly code: "INVALID_STOCK_STATUS";
      readonly received: string;
    }
  | {
      readonly code: "INVALID_LOCATION_KIND";
      readonly received: string;
    }
  | {
      readonly code: "UNKNOWN_VIRTUAL_BOUNDARY";
      readonly received: string;
    }
  | {
      readonly code: "MALFORMED_BUCKET_KEY";
      readonly received: string;
      readonly reason:
        | "PREFIX"
        | "FIELD_COUNT"
        | "FIELD_SYNTAX"
        | "FIELD_LENGTH"
        | "TRAILING_INPUT";
    };

export const MAX_BUCKET_COMPONENT_LENGTH = 64;

const COMPONENT_PATTERN = /^[A-Za-z0-9_.-]+$/;

export const BUCKET_KEY_PREFIX = "IB1";

const FIELD_SEPARATOR = "|";
const ABSENT_FIELD = "-";
const LENGTH_TERMINATOR = ":";

const KEY_FIELDS = [
  "orgId",
  "warehouseId",
  "itemId",
  "locationKind",
  "locationRef",
  "lotId",
  "serialId",
  "handlingUnitId",
  "ownerId",
  "stockStatus",
] as const;

const OPTIONAL_KEY_FIELDS: ReadonlySet<string> = new Set([
  "lotId",
  "serialId",
  "handlingUnitId",
  "ownerId",
]);

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (isString(value))
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return typeof value;
}

function validateComponent(
  component: string,
  value: unknown,
): Result<string, BucketError> {
  if (value === undefined || value === null) {
    return fail({ code: "MISSING_COMPONENT", component });
  }
  if (!isString(value) || value.length === 0) {
    return fail({
      code: "INVALID_COMPONENT",
      component,
      received: describe(value),
    });
  }
  if (value.length > MAX_BUCKET_COMPONENT_LENGTH) {
    return fail({
      code: "COMPONENT_TOO_LONG",
      component,
      length: value.length,
      limit: MAX_BUCKET_COMPONENT_LENGTH,
    });
  }
  if (!COMPONENT_PATTERN.test(value)) {
    return fail({
      code: "INVALID_COMPONENT",
      component,
      received: describe(value),
    });
  }
  return ok(value);
}

function validateOptionalComponent(
  component: string,
  value: unknown,
): Result<string | undefined, BucketError> {
  if (value === undefined || value === null) return ok(undefined);
  const validated = validateComponent(component, value);
  return validated.ok ? ok(validated.value) : validated;
}

export function validateLedgerLocation(
  location: LedgerLocation,
): Result<LedgerLocation, BucketError> {
  if (!isRecord(location)) {
    return fail({ code: "NOT_A_BUCKET", received: describe(location) });
  }
  const kind = location.kind;
  if (kind === "PHYSICAL") {
    const locationId = validateComponent(
      "locationId",
      (location as { locationId?: unknown }).locationId,
    );
    if (!locationId.ok) return locationId;
    return ok(
      Object.freeze({
        kind: "PHYSICAL" as const,
        locationId: locationId.value,
      }),
    );
  }
  if (kind === "VIRTUAL") {
    const raw = (location as { boundary?: unknown }).boundary;
    if (!isString(raw)) {
      return fail({
        code: "UNKNOWN_VIRTUAL_BOUNDARY",
        received: describe(raw),
      });
    }
    if (virtualBoundaryByCode(raw) === null) {
      return fail({ code: "UNKNOWN_VIRTUAL_BOUNDARY", received: raw });
    }
    return ok(Object.freeze({ kind: "VIRTUAL" as const, boundary: raw }));
  }
  return fail({ code: "INVALID_LOCATION_KIND", received: describe(kind) });
}

export const physicalLocation = (
  locationId: string,
): Result<LedgerLocation, BucketError> =>
  validateLedgerLocation({ kind: "PHYSICAL", locationId });

export const virtualLocation = (
  boundaryCode: string,
): Result<LedgerLocation, BucketError> =>
  validateLedgerLocation({
    kind: "VIRTUAL",
    boundary: boundaryCode as VirtualBoundaryCode,
  });

export const isPhysicalLocation = (
  location: LedgerLocation,
): location is PhysicalLocation => location.kind === "PHYSICAL";

export function validateBucket(
  bucket: InventoryBucket,
): Result<InventoryBucket, BucketError> {
  if (!isRecord(bucket)) {
    return fail({ code: "NOT_A_BUCKET", received: describe(bucket) });
  }

  const orgId = validateComponent("orgId", bucket.orgId);
  if (!orgId.ok) return orgId;
  const warehouseId = validateComponent("warehouseId", bucket.warehouseId);
  if (!warehouseId.ok) return warehouseId;
  const itemId = validateComponent("itemId", bucket.itemId);
  if (!itemId.ok) return itemId;
  const location = validateLedgerLocation(bucket.location as LedgerLocation);
  if (!location.ok) return location;
  const lotId = validateOptionalComponent("lotId", bucket.lotId);
  if (!lotId.ok) return lotId;
  const serialId = validateOptionalComponent("serialId", bucket.serialId);
  if (!serialId.ok) return serialId;
  const handlingUnitId = validateOptionalComponent(
    "handlingUnitId",
    bucket.handlingUnitId,
  );
  if (!handlingUnitId.ok) return handlingUnitId;
  const ownerId = validateOptionalComponent("ownerId", bucket.ownerId);
  if (!ownerId.ok) return ownerId;
  if (!isStockStatus(bucket.stockStatus)) {
    return fail({
      code: "INVALID_STOCK_STATUS",
      received: describe(bucket.stockStatus),
    });
  }

  return ok(
    Object.freeze({
      orgId: orgId.value,
      warehouseId: warehouseId.value,
      itemId: itemId.value,
      location: location.value,
      ...(lotId.value === undefined ? {} : { lotId: lotId.value }),
      ...(serialId.value === undefined ? {} : { serialId: serialId.value }),
      ...(handlingUnitId.value === undefined
        ? {}
        : { handlingUnitId: handlingUnitId.value }),
      ...(ownerId.value === undefined ? {} : { ownerId: ownerId.value }),
      stockStatus: bucket.stockStatus,
    }),
  );
}

const encodeField = (value: string | undefined): string =>
  value === undefined
    ? `${FIELD_SEPARATOR}${ABSENT_FIELD}`
    : `${FIELD_SEPARATOR}${value.length}${LENGTH_TERMINATOR}${value}`;

export function encodeBucketKey(
  bucket: InventoryBucket,
): Result<string, BucketError> {
  const validated = validateBucket(bucket);
  if (!validated.ok) return validated;
  const value = validated.value;
  const location = value.location;

  const fields: readonly (string | undefined)[] = [
    value.orgId,
    value.warehouseId,
    value.itemId,
    location.kind === "PHYSICAL" ? "PHYSICAL" : "VIRTUAL",
    location.kind === "PHYSICAL" ? location.locationId : location.boundary,
    value.lotId,
    value.serialId,
    value.handlingUnitId,
    value.ownerId,
    value.stockStatus,
  ];

  return ok(BUCKET_KEY_PREFIX + fields.map(encodeField).join(""));
}

export function decodeBucketKey(
  key: string,
): Result<InventoryBucket, BucketError> {
  if (!isString(key) || !key.startsWith(BUCKET_KEY_PREFIX)) {
    return fail({
      code: "MALFORMED_BUCKET_KEY",
      received: describe(key),
      reason: "PREFIX",
    });
  }

  const parsed: (string | undefined)[] = [];
  let cursor = BUCKET_KEY_PREFIX.length;

  for (let index = 0; index < KEY_FIELDS.length; index += 1) {
    if (key[cursor] !== FIELD_SEPARATOR) {
      return fail({
        code: "MALFORMED_BUCKET_KEY",
        received: describe(key),
        reason: "FIELD_COUNT",
      });
    }
    cursor += 1;
    if (key[cursor] === ABSENT_FIELD) {
      parsed.push(undefined);
      cursor += 1;
      continue;
    }
    const terminator = key.indexOf(LENGTH_TERMINATOR, cursor);
    if (terminator === -1 || terminator === cursor) {
      return fail({
        code: "MALFORMED_BUCKET_KEY",
        received: describe(key),
        reason: "FIELD_SYNTAX",
      });
    }
    const digits = key.slice(cursor, terminator);
    if (!/^(?:0|[1-9]\d{0,3})$/.test(digits)) {
      return fail({
        code: "MALFORMED_BUCKET_KEY",
        received: describe(key),
        reason: "FIELD_SYNTAX",
      });
    }
    const length = Number(digits);
    const start = terminator + 1;
    const end = start + length;
    if (end > key.length) {
      return fail({
        code: "MALFORMED_BUCKET_KEY",
        received: describe(key),
        reason: "FIELD_LENGTH",
      });
    }
    parsed.push(key.slice(start, end));
    cursor = end;
  }

  if (cursor !== key.length) {
    return fail({
      code: "MALFORMED_BUCKET_KEY",
      received: describe(key),
      reason: "TRAILING_INPUT",
    });
  }

  const [
    orgId,
    warehouseId,
    itemId,
    locationKind,
    locationRef,
    lotId,
    serialId,
    handlingUnitId,
    ownerId,
    stockStatus,
  ] = parsed;

  for (const [index, field] of KEY_FIELDS.entries()) {
    if (parsed[index] === undefined && !OPTIONAL_KEY_FIELDS.has(field)) {
      return fail({
        code: "MALFORMED_BUCKET_KEY",
        received: describe(key),
        reason: "FIELD_COUNT",
      });
    }
  }

  if (locationKind !== "PHYSICAL" && locationKind !== "VIRTUAL") {
    return fail({
      code: "INVALID_LOCATION_KIND",
      received: describe(locationKind),
    });
  }
  const location: LedgerLocation =
    locationKind === "PHYSICAL"
      ? { kind: "PHYSICAL", locationId: locationRef as string }
      : { kind: "VIRTUAL", boundary: locationRef as VirtualBoundaryCode };

  return validateBucket({
    orgId: orgId as string,
    warehouseId: warehouseId as string,
    itemId: itemId as string,
    location,
    ...(lotId === undefined ? {} : { lotId }),
    ...(serialId === undefined ? {} : { serialId }),
    ...(handlingUnitId === undefined ? {} : { handlingUnitId }),
    ...(ownerId === undefined ? {} : { ownerId }),
    stockStatus: stockStatus as StockStatus,
  });
}

export interface ConservationKey {
  readonly orgId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly lotId?: string | undefined;
  readonly serialId?: string | undefined;
  readonly ownerId?: string | undefined;
  readonly uom: string;
}

export const CONSERVATION_KEY_PREFIX = "CG1";

export function encodeConservationKey(
  input: ConservationKey,
): Result<string, BucketError> {
  if (!isRecord(input)) {
    return fail({ code: "NOT_A_BUCKET", received: describe(input) });
  }
  const orgId = validateComponent("orgId", input.orgId);
  if (!orgId.ok) return orgId;
  const warehouseId = validateComponent("warehouseId", input.warehouseId);
  if (!warehouseId.ok) return warehouseId;
  const itemId = validateComponent("itemId", input.itemId);
  if (!itemId.ok) return itemId;
  const lotId = validateOptionalComponent("lotId", input.lotId);
  if (!lotId.ok) return lotId;
  const serialId = validateOptionalComponent("serialId", input.serialId);
  if (!serialId.ok) return serialId;
  const ownerId = validateOptionalComponent("ownerId", input.ownerId);
  if (!ownerId.ok) return ownerId;
  const uom = validateComponent("uom", input.uom);
  if (!uom.ok) return uom;

  const fields: readonly (string | undefined)[] = [
    orgId.value,
    warehouseId.value,
    itemId.value,
    lotId.value,
    serialId.value,
    ownerId.value,
    uom.value,
  ];
  return ok(CONSERVATION_KEY_PREFIX + fields.map(encodeField).join(""));
}

export function conservationKeyOfBucket(
  bucket: InventoryBucket,
  uom: string,
): Result<string, BucketError> {
  const validated = validateBucket(bucket);
  if (!validated.ok) return validated;
  const value = validated.value;
  return encodeConservationKey({
    orgId: value.orgId,
    warehouseId: value.warehouseId,
    itemId: value.itemId,
    ...(value.lotId === undefined ? {} : { lotId: value.lotId }),
    ...(value.serialId === undefined ? {} : { serialId: value.serialId }),
    ...(value.ownerId === undefined ? {} : { ownerId: value.ownerId }),
    uom,
  });
}
