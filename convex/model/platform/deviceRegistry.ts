import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

export const MAX_DEVICE_LABEL_LENGTH = 48;

export const MAX_INSTALLATION_ID_LENGTH = 64;

/** Shortest installation ID accepted; below this it cannot be a minted value. */
export const MIN_INSTALLATION_ID_LENGTH = 8;

const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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

export interface RegisteredDevice {
  readonly deviceId: string;
  readonly label: string;
  readonly status: DeviceStatus;
  readonly installationId?: string | undefined;
}

export type BindingDecision =
  | { readonly kind: "ALREADY_BOUND"; readonly deviceId: string }
  /** Write the binding onto this device. */
  | {
      readonly kind: "BIND";
      readonly deviceId: string;
      readonly installationId: string;
    };

export function decideInstallationBinding(input: {
  readonly device: RegisteredDevice;
  readonly installationId: string;

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

  readonly releasesInstallation: boolean;
}

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
