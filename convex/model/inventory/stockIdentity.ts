/**
 * Inventory bucket identity: what a ledger line is *about*.
 *
 * Status: **implemented.** Pure module (plan §6.2): no Convex imports, and no
 * imports outside `convex/model/**`.
 *
 * A bucket is the nine-dimensional address plan §7.4 gives it — organization,
 * warehouse, item, location, optional lot, optional serial, optional handling
 * unit, stock status, optional owner ([ADR-0005](../../../docs/adr/0005-warehouse-location-and-stock-identity.md)
 * §7, `ADR-0003` §3). Two things live here and nowhere else:
 *
 * 1. **The canonical key.** A balance row is looked up by one string, so that
 *    string has to be a *total injection* from bucket to key: two different
 *    buckets must never encode alike, or one bucket's stock lands in another's
 *    row. Joining components with a delimiter does not have that property —
 *    `("AB", "C")` and `("A", "BC")` both render `AB|C` under any separator the
 *    components may contain — so every component is length-prefixed
 *    (`5:ALPHA`) and an absent optional component is a sentinel (`-`) that a
 *    present one cannot produce. `decodeBucketKey` is the left inverse, which is
 *    what makes injectivity testable rather than argued: `decode(encode(b)) === b`
 *    for every valid `b`, so `encode(x) === encode(y)` implies `x === y`.
 *
 *    Length prefixes make delimiters harmless, and components are *still* refused
 *    if they contain `|` or `:`. That is deliberate belt-and-braces: a future
 *    consumer that splits the key naively — a log query, a dashboard, a support
 *    script — should not be foolable either, and the components this domain
 *    actually carries (Convex document IDs and closed-set codes) never need those
 *    characters.
 *
 * 2. **Physical versus virtual.** Everything outside the warehouse — a supplier,
 *    a customer, production, an adjustment counterparty, scrap — is a *virtual
 *    boundary location* (`G-023`, `ADR-0003` §2, `ADR-0005` §4), so a receipt is a
 *    balanced two-sided posting instead of a single-sided one nobody can verify.
 *    The boundaries are **code-owned constants**, not rows: inventing
 *    `locations` documents for them would be master data with no physical
 *    referent, and a tenant could then edit, deactivate, or re-parent the
 *    counterparty the ledger balances against.
 *
 *    A location reference is therefore a discriminated union, and the
 *    discriminant is validated rather than inferred from which field is present:
 *    `{ kind: "PHYSICAL", boundary: "SCRAP_DAMAGE" } as LedgerLocation` compiles,
 *    and a value read back out of a document is exactly that kind of value.
 *
 * Every public function re-validates what it is handed and answers a `Result`.
 * Every value it constructs is shallow-frozen; `Object.freeze` is shallow, so
 * that is the whole of the guarantee.
 */
import { frozenArray, isRecord, isString, recordValue } from "../guards";
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Closed value sets                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The quality/availability dimension of a bucket (`G-053`, D-11).
 *
 * `AVAILABLE` is the only status this module treats specially, and only in one
 * place: `isAvailableStatus`, which the non-negativity rule reads (D-12,
 * `INV-0003-06`). The rest are ordinary values.
 *
 * `EXPIRED` is present because §5 Q19 makes expiry "an explicit scheduled status
 * transaction" — a paired posting needs a status to post *into*, and reusing
 * `REJECTED` would make an expired lot indistinguishable from a QC failure in
 * every history screen and report. The other five are the glossary's set.
 */
export const STOCK_STATUSES = [
  "AVAILABLE",
  "QC_HOLD",
  "QUARANTINE",
  "REJECTED",
  "SCRAP",
  "EXPIRED",
] as const;

export type StockStatus = (typeof STOCK_STATUSES)[number];

/** Whether a value is one of the six statuses. Total: a forged status is `false`. */
export const isStockStatus = (value: unknown): value is StockStatus =>
  isString(value) && (STOCK_STATUSES as readonly string[]).includes(value);

/**
 * The stock status the non-negativity rule guards unconditionally (D-12).
 *
 * `organizations.settings.negativeAvailableAllowed` exists in the schema and
 * defaults to `false`; **this module does not read it**, and neither does the
 * mutation that calls this module. A negative `AVAILABLE` result is refused
 * whatever that flag says, until the exception design — the explicit tenant
 * setting, the `inventory.negativeStock.override` permission, and the audit trail
 * D-12 requires — actually exists. A flag that silently enables negative stock
 * before then is exactly the failure D-12 is written against.
 */
export const isAvailableStatus = (status: StockStatus): boolean =>
  status === "AVAILABLE";

/**
 * Which direction stock may cross a boundary in.
 *
 * `SOURCE` boundaries only ever *supply* stock, so their own posting is negative:
 * receiving ten cases is `+10` at the dock and `-10` at `SUPPLIER_RECEIPT`. A
 * `SINK` is the mirror. `BOTH` is for counterparties that legitimately go either
 * way — a stock count that finds more or less than the ledger says.
 *
 * This is checked (`virtualBoundaryDirectionViolation`), which is what stops a
 * transaction from "receiving stock into the supplier".
 */
export type BoundaryFlow = "SOURCE" | "SINK" | "BOTH";

/** A code-owned counterparty outside the warehouse (`G-023`). */
export interface VirtualBoundary {
  readonly code: string;
  readonly flow: BoundaryFlow;
  /** Why it exists, in one line. Not a UI string: the UI owns translation (D-06). */
  readonly purpose: string;
}

const boundary = (
  code: string,
  flow: BoundaryFlow,
  purpose: string,
): VirtualBoundary => Object.freeze({ code, flow, purpose });

/**
 * Every boundary the inbound slice and its neighbours need, and no more.
 *
 * Seven, chosen so each flow plan §7.4 mentions has exactly one counterparty and
 * no flow needs a physical location invented for it. Adding an eighth is a domain
 * decision — a new boundary is a new kind of movement — which is why they are
 * enumerated here rather than accepted as strings.
 */
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

/** The boundary codes, sorted, as a frozen array. */
export const virtualBoundaryCodes = (): readonly string[] =>
  frozenArray(Object.keys(VIRTUAL_BOUNDARIES).sort());

/** The boundary a code names, or `null`. Never `undefined`, never a prototype hit. */
export const virtualBoundaryByCode = (code: string): VirtualBoundary | null =>
  isString(code) ? recordValue(VIRTUAL_BOUNDARIES, code) : null;

/* -------------------------------------------------------------------------- */
/* Location reference                                                          */
/* -------------------------------------------------------------------------- */

/** A shelf, bin, dock, or block inside the warehouse: a `locations` document. */
export interface PhysicalLocation {
  readonly kind: "PHYSICAL";
  readonly locationId: string;
}

/** A code-owned counterparty outside the warehouse. Carries no document ID. */
export interface VirtualLocation {
  readonly kind: "VIRTUAL";
  readonly boundary: VirtualBoundaryCode;
}

export type LedgerLocation = PhysicalLocation | VirtualLocation;

/* -------------------------------------------------------------------------- */
/* Bucket                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The address of a balance (`ADR-0003` §3, plan §7.4).
 *
 * `serialId` is declared and never populated by the MVP: serial *flows* stay off
 * (D-09, `INV-0005-08`), and the point of declaring the dimension now is that
 * enabling them later does not re-key the ledger (B-06).
 *
 * `ownerId` is declared and stays absent while `consignedStockEnabled` is off
 * (D-11). It is part of identity rather than a status value because it is a legal
 * dimension, not a quality one.
 */
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

/**
 * Longest a single key component may be. Convex document IDs are far shorter, and
 * the closed-set codes shorter still; the bound exists so a forged component
 * cannot make an unbounded index key.
 */
export const MAX_BUCKET_COMPONENT_LENGTH = 64;

/**
 * Characters a component may contain: ASCII letters, digits, `_`, `.`, `-`.
 *
 * Excludes `|` and `:` — the key's own punctuation — even though the length
 * prefix already makes them unambiguous. See the module note.
 */
const COMPONENT_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** Version tag, so a stored key from a future encoding is refused, not misread. */
export const BUCKET_KEY_PREFIX = "IB1";

const FIELD_SEPARATOR = "|";
const ABSENT_FIELD = "-";
const LENGTH_TERMINATOR = ":";

/** The order fields are encoded in. Named so the encoder and decoder share it. */
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

/** Which of those may be absent. The rest are required. */
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

/** A required component: a non-empty, bounded, pattern-clean string. */
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

/**
 * An optional component: absent, or a valid one.
 *
 * `null` and `undefined` are both absent, and an *empty string* is not — it is
 * `INVALID_COMPONENT`. An empty string that meant "absent" would encode as
 * `0:` and collide with nothing today, but it would make "has no lot" and "has a
 * lot whose ID is empty" the same bucket, which is a distinction the caller
 * clearly did not intend to lose.
 */
function validateOptionalComponent(
  component: string,
  value: unknown,
): Result<string | undefined, BucketError> {
  if (value === undefined || value === null) return ok(undefined);
  const validated = validateComponent(component, value);
  return validated.ok ? ok(validated.value) : validated;
}

/**
 * Re-check a value that claims to be a `LedgerLocation`, and answer a frozen one.
 *
 * The discriminant decides, and it decides alone: a `PHYSICAL` value carrying a
 * `boundary` field keeps its `locationId` and drops the boundary, because a
 * reference with two readings is a reference the caller has to guess about.
 */
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

/** A physical location reference. */
export const physicalLocation = (
  locationId: string,
): Result<LedgerLocation, BucketError> =>
  validateLedgerLocation({ kind: "PHYSICAL", locationId });

/** A virtual boundary reference. */
export const virtualLocation = (
  boundaryCode: string,
): Result<LedgerLocation, BucketError> =>
  validateLedgerLocation({
    kind: "VIRTUAL",
    boundary: boundaryCode as VirtualBoundaryCode,
  });

/** Whether a validated location is inside the warehouse. */
export const isPhysicalLocation = (
  location: LedgerLocation,
): location is PhysicalLocation => location.kind === "PHYSICAL";

/**
 * Re-check a value that claims to be an `InventoryBucket` and answer a frozen,
 * normalized one.
 *
 * Normalized means: absent optional dimensions are *omitted*, never present-and-
 * `undefined`. Two buckets that differ only in that would encode identically —
 * which is correct — but would not be `toEqual` in a test or `===` after a
 * structural comparison, so the shape is settled here rather than at each call
 * site.
 */
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

/* -------------------------------------------------------------------------- */
/* Canonical key                                                               */
/* -------------------------------------------------------------------------- */

const encodeField = (value: string | undefined): string =>
  value === undefined
    ? `${FIELD_SEPARATOR}${ABSENT_FIELD}`
    : `${FIELD_SEPARATOR}${value.length}${LENGTH_TERMINATOR}${value}`;

/**
 * The single string a balance row is keyed by.
 *
 * Validates first: an unvalidated bucket cannot produce a key, because a key is
 * the thing that decides which row stock lands in. See the module note for why
 * the encoding is length-prefixed rather than delimiter-joined.
 */
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

/**
 * The left inverse of `encodeBucketKey`.
 *
 * Exists for two reasons, one practical and one about proof. Practically, a
 * balance row and a reconciliation drift record are addressed by key, and a
 * reader that needs the dimensions back should not have to store them twice. For
 * proof: `decode(encode(b))` equalling `b` for every valid bucket is what makes
 * the encoding injective, and injectivity is the property that stops one bucket's
 * stock from landing in another's row. A property test asserts exactly that.
 */
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

  // A required field decoded as absent, or an optional one that the encoder
  // would never have emitted, is a malformed key rather than a bucket with a
  // hole in it.
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

/* -------------------------------------------------------------------------- */
/* Conservation identity                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The dimensions stock is *conserved* across, which is a strictly coarser address
 * than the bucket.
 *
 * A transaction must balance to zero per conservation group, not per bucket —
 * otherwise nothing could ever move. Putaway changes `location`, building a
 * pallet changes `handlingUnitId`, a QC release changes `stockStatus`, and all
 * three are balanced movements of the same stock. What may *not* change inside
 * one transaction is which physical thing is being moved: the organization, the
 * warehouse, the item, the lot, the serial, the owner, and the unit of measure.
 *
 * The warehouse is in the group on purpose. A cross-warehouse move is a real
 * operation and it is not this one: it needs a transfer aggregate, an in-transit
 * status, and two authorizations. Leaving `warehouseId` out of the group would
 * make it silently expressible as a single balanced transaction, which is the
 * failure `ADR-0003` §2 and plan §7.5 both name. `ledgerTransaction.ts` also
 * refuses a line whose warehouse differs from the header's, so the mistake is
 * caught by its own error rather than as an unbalanced sum.
 */
export interface ConservationKey {
  readonly orgId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly lotId?: string | undefined;
  readonly serialId?: string | undefined;
  readonly ownerId?: string | undefined;
  readonly uom: string;
}

/**
 * The conservation group of a bucket and a UOM, as a canonical string.
 *
 * Uses the same length-prefixed encoding, for the same reason, and its own prefix
 * so a conservation key can never be mistaken for — or compared equal to — a
 * bucket key.
 */
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

/** The conservation group a bucket belongs to, given the line's UOM. */
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
