/**
 * Device registration and the `deviceId` lifecycle (`G-013`, `ADR-0006` §8,
 * plan §8 `FF-P1-08`).
 *
 * Status: **implemented as the pure lifecycle.** `convex/platform/devices.ts`
 * is the tenant-bound writer; everything decidable without a database is here.
 *
 * ### What a device is, and what it is not
 *
 * A device is *context*: which handheld posted a transaction, so an incident
 * can be traced to a scanner rather than only to a person. It is never an
 * authorization subject, holds no secret, and grants nothing. That is why this
 * module has no notion of pairing, enrolment token, or trust level — a device
 * that could carry authority would be a shared privileged account with a
 * barcode on it.
 *
 * `installationId` is the opaque value the installed PWA mints for itself. It
 * correlates a browser installation to a registered row and authenticates
 * nothing (`convex/lib/tenantFunctions.ts` resolves it for the audit row only).
 * Because it is client-minted, this module treats it as untrusted input: it is
 * bounded, character-checked, and refused rather than trimmed into something
 * that merely looks valid.
 *
 * ### Why retirement is a state and not a delete
 *
 * Every transaction, audit row, and idempotency record that names a device
 * keeps naming it forever (D-27). Deleting the row would turn seven years of
 * evidence into dangling references. `RETIRED` therefore means "no new work
 * from this device", and the installation binding is released at the same
 * moment so a re-imaged handheld can register cleanly.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/** Longest device label. Fits a warehouse asset tag, not a paragraph. */
export const MAX_DEVICE_LABEL_LENGTH = 48;

/** Longest installation ID accepted. A UUID with room to spare. */
export const MAX_INSTALLATION_ID_LENGTH = 64;

/** Shortest installation ID accepted; below this it cannot be a minted value. */
export const MIN_INSTALLATION_ID_LENGTH = 8;

/** Opaque, client-minted, and therefore restricted to an unambiguous alphabet. */
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Anything in Unicode category C — control, format, surrogate, unassigned. */
const LABEL_FORBIDDEN = /\p{C}/u;

export type DeviceType = "HANDHELD" | "WORKSTATION" | "TABLET";
export const DEVICE_TYPES: readonly DeviceType[] = Object.freeze([
  "HANDHELD",
  "WORKSTATION",
  "TABLET",
]);

export type DeviceStatus = "ACTIVE" | "RETIRED";

export type DeviceError =
  | { readonly code: "LABEL_REQUIRED" }
  | {
      readonly code: "LABEL_TOO_LONG";
      readonly limit: number;
      readonly actualLength: number;
    }
  | { readonly code: "LABEL_INVALID_CHARACTER" }
  | { readonly code: "INSTALLATION_ID_INVALID" }
  | {
      readonly code: "INSTALLATION_ID_TOO_LONG";
      readonly limit: number;
      readonly actualLength: number;
    }
  | { readonly code: "DEVICE_TYPE_INVALID"; readonly received: string }
  | { readonly code: "DEVICE_RETIRED" }
  | { readonly code: "DEVICE_ALREADY_RETIRED" }
  | { readonly code: "INSTALLATION_ALREADY_BOUND" }
  | { readonly code: "CLOCK_INVALID" };

/* -------------------------------------------------------------------------- */
/* Normalization                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The stored form of a device label.
 *
 * Trimmed at the ends and NFC-composed so two encodings of the same Thai label
 * agree; internal spacing is preserved, because `"Dock 1 handheld"` is a label a
 * person wrote and collapsing it would rename their device. Case is preserved
 * for the same reason — the uniqueness contract is over the normalized label,
 * and folding it would tell a tenant that `Dock 1` and `DOCK 1` are one device.
 */
export function normalizeDeviceLabel(raw: string): Result<string, DeviceError> {
  if (!isString(raw)) return fail({ code: "LABEL_REQUIRED" });
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fail({ code: "LABEL_REQUIRED" });
  if (LABEL_FORBIDDEN.test(trimmed)) {
    return fail({ code: "LABEL_INVALID_CHARACTER" });
  }
  const composed = trimmed.normalize("NFC");
  if (composed.length > MAX_DEVICE_LABEL_LENGTH) {
    return fail({
      code: "LABEL_TOO_LONG",
      limit: MAX_DEVICE_LABEL_LENGTH,
      actualLength: composed.length,
    });
  }
  return ok(composed);
}

/**
 * The stored form of an installation ID.
 *
 * Deliberately not folded, not padded, and not repaired: it is an opaque
 * correlation value, so any transformation would make two different
 * installations look like one. A value outside the alphabet is refused, because
 * the only producer is our own PWA and anything else is either a probe or a
 * bug worth seeing.
 */
export function normalizeInstallationId(
  raw: string,
): Result<string, DeviceError> {
  if (!isString(raw)) return fail({ code: "INSTALLATION_ID_INVALID" });
  const trimmed = raw.trim();
  if (trimmed.length > MAX_INSTALLATION_ID_LENGTH) {
    return fail({
      code: "INSTALLATION_ID_TOO_LONG",
      limit: MAX_INSTALLATION_ID_LENGTH,
      actualLength: trimmed.length,
    });
  }
  if (
    trimmed.length < MIN_INSTALLATION_ID_LENGTH ||
    !INSTALLATION_ID_PATTERN.test(trimmed)
  ) {
    return fail({ code: "INSTALLATION_ID_INVALID" });
  }
  return ok(trimmed);
}

/** The declared form factor, checked against the closed set. */
export function normalizeDeviceType(
  raw: string,
): Result<DeviceType, DeviceError> {
  if (!isString(raw) || !(DEVICE_TYPES as readonly string[]).includes(raw)) {
    return fail({
      code: "DEVICE_TYPE_INVALID",
      received: isString(raw) ? raw : typeof raw,
    });
  }
  return ok(raw as DeviceType);
}

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

export interface DeviceRegistrationInput {
  readonly label: string;
  readonly deviceType: string;
  readonly installationId?: string | undefined;
  readonly now: number;
}

export interface DeviceRegistration {
  readonly label: string;
  readonly deviceType: DeviceType;
  readonly status: "ACTIVE";
  readonly installationId?: string;
  readonly lastSeenAt: number;
}

/**
 * Validate a registration. The status is always `ACTIVE`: a device registered
 * as retired is a row nobody asked for, and the retire path exists.
 */
export function planDeviceRegistration(
  input: DeviceRegistrationInput,
): Result<DeviceRegistration, DeviceError> {
  if (!isRecord(input)) return fail({ code: "LABEL_REQUIRED" });
  if (!isSafeInt(input.now) || input.now < 0) {
    return fail({ code: "CLOCK_INVALID" });
  }
  const label = normalizeDeviceLabel(input.label);
  if (!label.ok) return label;
  const deviceType = normalizeDeviceType(input.deviceType);
  if (!deviceType.ok) return deviceType;

  if (input.installationId === undefined) {
    return ok(
      Object.freeze({
        label: label.value,
        deviceType: deviceType.value,
        status: "ACTIVE" as const,
        lastSeenAt: input.now,
      }),
    );
  }

  const installationId = normalizeInstallationId(input.installationId);
  if (!installationId.ok) return installationId;
  return ok(
    Object.freeze({
      label: label.value,
      deviceType: deviceType.value,
      status: "ACTIVE" as const,
      installationId: installationId.value,
      lastSeenAt: input.now,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Binding                                                                     */
/* -------------------------------------------------------------------------- */

/** The stored row, as this module reads it. */
export interface RegisteredDevice {
  readonly deviceId: string;
  readonly label: string;
  readonly status: DeviceStatus;
  readonly installationId?: string | undefined;
}

export type BindingDecision =
  /** The installation already names this device; nothing to write. */
  | { readonly kind: "ALREADY_BOUND"; readonly deviceId: string }
  /** Write the binding onto this device. */
  | {
      readonly kind: "BIND";
      readonly deviceId: string;
      readonly installationId: string;
    };

/**
 * Decide whether an installation may be bound to a device.
 *
 * Two rules, both fail-closed:
 *
 * - A retired device accepts no binding. A re-imaged handheld that resolved to
 *   a retired row would keep posting under a device the tenant believes is out
 *   of service.
 * - An installation already bound *elsewhere* is refused rather than moved.
 *   Silently re-pointing it would make one physical browser appear as two
 *   devices in the audit trail — or worse, make two devices share a row.
 */
export function decideInstallationBinding(input: {
  readonly device: RegisteredDevice;
  readonly installationId: string;
  /** The device the installation is currently bound to, when it is bound. */
  readonly boundToDeviceId?: string | undefined;
}): Result<BindingDecision, DeviceError> {
  if (!isRecord(input) || !isRecord(input.device)) {
    return fail({ code: "INSTALLATION_ID_INVALID" });
  }
  const installationId = normalizeInstallationId(input.installationId);
  if (!installationId.ok) return installationId;
  if (input.device.status === "RETIRED") {
    return fail({ code: "DEVICE_RETIRED" });
  }
  if (
    input.boundToDeviceId !== undefined &&
    input.boundToDeviceId !== input.device.deviceId
  ) {
    return fail({ code: "INSTALLATION_ALREADY_BOUND" });
  }
  if (input.device.installationId === installationId.value) {
    return ok(
      Object.freeze({
        kind: "ALREADY_BOUND" as const,
        deviceId: input.device.deviceId,
      }),
    );
  }
  return ok(
    Object.freeze({
      kind: "BIND" as const,
      deviceId: input.device.deviceId,
      installationId: installationId.value,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Rename and retire                                                           */
/* -------------------------------------------------------------------------- */

/** A rename is refused on a retired device: its label is evidence now. */
export function planDeviceRename(input: {
  readonly device: RegisteredDevice;
  readonly label: string;
}): Result<{ readonly label: string }, DeviceError> {
  if (!isRecord(input) || !isRecord(input.device)) {
    return fail({ code: "LABEL_REQUIRED" });
  }
  if (input.device.status === "RETIRED") {
    return fail({ code: "DEVICE_RETIRED" });
  }
  const label = normalizeDeviceLabel(input.label);
  if (!label.ok) return label;
  return ok(Object.freeze({ label: label.value }));
}

export interface DeviceRetirement {
  readonly status: "RETIRED";
  readonly retiredAt: number;
  /**
   * True when the retirement releases an installation binding, so the caller
   * knows to clear the field rather than guessing from the row it just read.
   */
  readonly releasesInstallation: boolean;
}

/**
 * Retire a device.
 *
 * Retiring twice is refused rather than treated as a replay: `retiredAt` is
 * evidence of when the device left service, and a second retirement would
 * either overwrite that instant or silently keep the first while reporting
 * success for the second.
 */
export function planDeviceRetirement(input: {
  readonly device: RegisteredDevice;
  readonly now: number;
}): Result<DeviceRetirement, DeviceError> {
  if (!isRecord(input) || !isRecord(input.device)) {
    return fail({ code: "DEVICE_ALREADY_RETIRED" });
  }
  if (!isSafeInt(input.now) || input.now < 0) {
    return fail({ code: "CLOCK_INVALID" });
  }
  if (input.device.status === "RETIRED") {
    return fail({ code: "DEVICE_ALREADY_RETIRED" });
  }
  return ok(
    Object.freeze({
      status: "RETIRED" as const,
      retiredAt: input.now,
      releasesInstallation: input.device.installationId !== undefined,
    }),
  );
}
