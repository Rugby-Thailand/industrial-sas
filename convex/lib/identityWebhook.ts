export const IDENTITY_EVENT_TYPES = [
  "organization.upsert",
  "organization.delete",
  "user.upsert",
  "user.delete",
  "membership.upsert",
  "membership.delete",
] as const;

export type IdentityEventType = (typeof IDENTITY_EVENT_TYPES)[number];
export type IdentityEventOutcome = "APPLIED" | "REPLAY" | "STALE";
export type IdentityEntityKind = "ORGANIZATION" | "USER" | "MEMBERSHIP";

export const MAX_IDENTITY_REFERENCE_LENGTH = 128;
export const MAX_IDENTITY_DISPLAY_NAME_LENGTH = 256;

type EventEnvelope<Type extends IdentityEventType, Data> = {
  readonly eventId: string;
  readonly eventAt: number;
  /** Signed Clerk event time, used to break equal object-clock ties. */
  readonly eventTimestamp?: number;
  readonly type: Type;
  readonly data: Data;
};

type OrganizationIdentity = {
  readonly clerkOrganizationId: string;
  readonly name: string;
};

type UserIdentity = {
  readonly clerkUserId: string;
  readonly displayName: string;
  readonly preferredLocale?: "th" | "en";
};

type MembershipIdentity = OrganizationIdentity &
  UserIdentity & {
    readonly clerkMembershipId: string;
  };

export type IdentityWebhookEvent =
  | EventEnvelope<"organization.upsert", OrganizationIdentity>
  | EventEnvelope<
      "organization.delete",
      Pick<OrganizationIdentity, "clerkOrganizationId">
    >
  | EventEnvelope<"user.upsert", UserIdentity>
  | EventEnvelope<"user.delete", Pick<UserIdentity, "clerkUserId">>
  | EventEnvelope<"membership.upsert", MembershipIdentity>
  | EventEnvelope<"membership.delete", MembershipIdentity>;

type MembershipEvent =
  | EventEnvelope<"membership.upsert", MembershipIdentity>
  | EventEnvelope<"membership.delete", MembershipIdentity>;

export interface IdentityWatermark {
  readonly clerkLastEventId?: string;
  readonly clerkLastEventAt?: number;
  readonly clerkLastEventTimestamp?: number;
}

export interface MirroredOrganization extends IdentityWatermark {
  readonly clerkOrganizationId: string;
  readonly name: string;
  readonly status: "ACTIVE" | "SUSPENDED" | "CLOSED";
}

export interface MirroredUser extends IdentityWatermark {
  readonly clerkUserId: string;
  readonly displayName: string;
  readonly status: "ACTIVE" | "DEACTIVATED";
  readonly preferredLocale?: "th" | "en";
}

export interface MirroredMembership extends IdentityWatermark {
  readonly clerkOrganizationId: string;
  readonly clerkUserId: string;
  readonly clerkMembershipId: string;
  readonly status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  readonly scopeMode: "ORG_WIDE" | "WAREHOUSE_SCOPED";
  readonly effectiveFrom: number;
  readonly effectiveTo?: number;
}

export interface IdentityMirrorPort {
  readonly findOrganization: (
    clerkOrganizationId: string,
  ) => Promise<MirroredOrganization | null>;
  readonly putOrganization: (value: MirroredOrganization) => Promise<void>;
  readonly findUser: (clerkUserId: string) => Promise<MirroredUser | null>;
  readonly putUser: (value: MirroredUser) => Promise<void>;
  readonly findMembership: (input: {
    readonly clerkOrganizationId: string;
    readonly clerkMembershipId: string;
  }) => Promise<MirroredMembership | null>;
  readonly putMembership: (value: MirroredMembership) => Promise<void>;
}

export interface IdentityEventResult {
  readonly outcome: IdentityEventOutcome;
  readonly entityKind: IdentityEntityKind;
  readonly externalId: string;
}

export class InvalidIdentityEventError extends Error {
  constructor() {
    super("The normalized identity event is invalid.");
    this.name = "InvalidIdentityEventError";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

const UNSAFE_TEXT = /[\p{Cc}\u2028\u2029]/u;

export function isValidIdentityText(
  value: unknown,
  max: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    value.length <= max &&
    !UNSAFE_TEXT.test(value)
  );
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length) throw new InvalidIdentityEventError();
  if (actual.some((key, index) => key !== expected[index])) {
    throw new InvalidIdentityEventError();
  }
}

function boundedString(value: unknown, max: number): asserts value is string {
  if (!isValidIdentityText(value, max)) {
    throw new InvalidIdentityEventError();
  }
}

function validateOrganization(data: Record<string, unknown>, name: boolean) {
  exactKeys(
    data,
    name ? ["clerkOrganizationId", "name"] : ["clerkOrganizationId"],
  );
  boundedString(data.clerkOrganizationId, MAX_IDENTITY_REFERENCE_LENGTH);
  if (name) boundedString(data.name, MAX_IDENTITY_DISPLAY_NAME_LENGTH);
}

function validateUser(data: Record<string, unknown>, display: boolean) {
  exactKeys(
    data,
    display
      ? [
          "clerkUserId",
          "displayName",
          ...(data.preferredLocale === undefined ? [] : ["preferredLocale"]),
        ]
      : ["clerkUserId"],
  );
  boundedString(data.clerkUserId, MAX_IDENTITY_REFERENCE_LENGTH);
  if (display) {
    boundedString(data.displayName, MAX_IDENTITY_DISPLAY_NAME_LENGTH);
    if (
      data.preferredLocale !== undefined &&
      data.preferredLocale !== "th" &&
      data.preferredLocale !== "en"
    ) {
      throw new InvalidIdentityEventError();
    }
  }
}

function validateMembership(data: Record<string, unknown>) {
  exactKeys(data, [
    "clerkMembershipId",
    "clerkOrganizationId",
    "name",
    "clerkUserId",
    "displayName",
    ...(data.preferredLocale === undefined ? [] : ["preferredLocale"]),
  ]);
  boundedString(data.clerkMembershipId, MAX_IDENTITY_REFERENCE_LENGTH);
  boundedString(data.clerkOrganizationId, MAX_IDENTITY_REFERENCE_LENGTH);
  boundedString(data.name, MAX_IDENTITY_DISPLAY_NAME_LENGTH);
  boundedString(data.clerkUserId, MAX_IDENTITY_REFERENCE_LENGTH);
  boundedString(data.displayName, MAX_IDENTITY_DISPLAY_NAME_LENGTH);
  if (
    data.preferredLocale !== undefined &&
    data.preferredLocale !== "th" &&
    data.preferredLocale !== "en"
  ) {
    throw new InvalidIdentityEventError();
  }
}

function validateEvent(value: unknown): asserts value is IdentityWebhookEvent {
  if (!isPlainRecord(value)) throw new InvalidIdentityEventError();
  exactKeys(value, [
    "eventId",
    "eventAt",
    "type",
    "data",
    ...(value.eventTimestamp === undefined ? [] : ["eventTimestamp"]),
  ]);
  boundedString(value.eventId, MAX_IDENTITY_REFERENCE_LENGTH);
  if (!Number.isSafeInteger(value.eventAt) || (value.eventAt as number) < 0) {
    throw new InvalidIdentityEventError();
  }
  if (
    value.eventTimestamp !== undefined &&
    (!Number.isSafeInteger(value.eventTimestamp) ||
      (value.eventTimestamp as number) < (value.eventAt as number))
  ) {
    throw new InvalidIdentityEventError();
  }
  if (!IDENTITY_EVENT_TYPES.includes(value.type as IdentityEventType)) {
    throw new InvalidIdentityEventError();
  }
  if (!isPlainRecord(value.data)) throw new InvalidIdentityEventError();

  switch (value.type as IdentityEventType) {
    case "organization.upsert":
      validateOrganization(value.data, true);
      break;
    case "organization.delete":
      validateOrganization(value.data, false);
      break;
    case "user.upsert":
      validateUser(value.data, true);
      break;
    case "user.delete":
      validateUser(value.data, false);
      break;
    case "membership.upsert":
    case "membership.delete":
      validateMembership(value.data);
      break;
  }
}

function outcomeFor(
  existing: IdentityWatermark | null,
  event: IdentityWebhookEvent,
): IdentityEventOutcome {
  if (existing?.clerkLastEventId === event.eventId) return "REPLAY";
  const previousAt = existing?.clerkLastEventAt;
  if (previousAt !== undefined) {
    if (event.eventAt < previousAt) return "STALE";
    if (event.eventAt === previousAt) {
      // Legacy records used delivery time. Never lower or reinterpret that
      // floor, and never resolve its ties using the new source event clock.
      if (
        existing?.clerkLastEventTimestamp === undefined ||
        event.eventTimestamp === undefined ||
        event.eventTimestamp <= existing.clerkLastEventTimestamp
      )
        return "STALE";
    }
  }
  return "APPLIED";
}

function watermark(event: IdentityWebhookEvent) {
  return {
    clerkLastEventId: event.eventId,
    clerkLastEventAt: event.eventAt,
    ...(event.eventTimestamp === undefined
      ? {}
      : { clerkLastEventTimestamp: event.eventTimestamp }),
  } as const;
}

function deletionWatermark(
  existing: IdentityWatermark | null,
  event: IdentityWebhookEvent,
) {
  // A terminal delete must revoke access even below a legacy delivery floor.
  // Keep that floor (and any source tie-break) while recording the deletion ID;
  // never reset history merely to make incomparable clocks look comparable.
  if (outcomeFor(existing, event) !== "STALE") return watermark(event);
  return {
    clerkLastEventId: event.eventId,
    ...(existing?.clerkLastEventAt === undefined
      ? {}
      : { clerkLastEventAt: existing.clerkLastEventAt }),
    ...(existing?.clerkLastEventTimestamp === undefined
      ? {}
      : { clerkLastEventTimestamp: existing.clerkLastEventTimestamp }),
  };
}

async function provisionEmbeddedIdentity(
  event: MembershipEvent,
  port: IdentityMirrorPort,
) {
  const organization = await port.findOrganization(
    event.data.clerkOrganizationId,
  );
  // An embedded organization/user is not the membership object whose clock we
  // just validated. Only provision absent parents; their own lifecycle events
  // update existing metadata, status and watermarks.
  if (organization === null) {
    await port.putOrganization({
      clerkOrganizationId: event.data.clerkOrganizationId,
      name: event.data.name,
      status: event.type === "membership.upsert" ? "ACTIVE" : "CLOSED",
    });
  }

  const user = await port.findUser(event.data.clerkUserId);
  if (user === null) {
    await port.putUser({
      clerkUserId: event.data.clerkUserId,
      displayName: event.data.displayName,
      status: event.type === "membership.upsert" ? "ACTIVE" : "DEACTIVATED",
      ...(event.data.preferredLocale === undefined
        ? {}
        : { preferredLocale: event.data.preferredLocale }),
    });
  }
}

export async function applyIdentityWebhookEvent(
  event: IdentityWebhookEvent,
  port: IdentityMirrorPort,
): Promise<IdentityEventResult> {
  validateEvent(event);

  if (
    event.type === "organization.upsert" ||
    event.type === "organization.delete"
  ) {
    const existing = await port.findOrganization(
      event.data.clerkOrganizationId,
    );
    const ordered = outcomeFor(existing, event);
    const outcome =
      ordered === "STALE" &&
      event.type === "organization.delete" &&
      existing?.status !== "CLOSED"
        ? "APPLIED"
        : ordered;
    if (outcome === "APPLIED") {
      await port.putOrganization({
        clerkOrganizationId: event.data.clerkOrganizationId,
        name:
          event.type === "organization.upsert"
            ? event.data.name
            : (existing?.name ?? "Deleted organization"),
        status:
          event.type === "organization.delete"
            ? "CLOSED"
            : (existing?.status ?? "ACTIVE"),
        ...(event.type === "organization.delete"
          ? deletionWatermark(existing, event)
          : watermark(event)),
      });
    }
    return {
      outcome,
      entityKind: "ORGANIZATION",
      externalId: event.data.clerkOrganizationId,
    };
  }

  if (event.type === "user.upsert" || event.type === "user.delete") {
    const existing = await port.findUser(event.data.clerkUserId);
    const ordered = outcomeFor(existing, event);
    const outcome =
      ordered === "STALE" &&
      event.type === "user.delete" &&
      existing?.status !== "DEACTIVATED"
        ? "APPLIED"
        : ordered;
    if (outcome === "APPLIED") {
      await port.putUser({
        clerkUserId: event.data.clerkUserId,
        displayName:
          event.type === "user.upsert"
            ? event.data.displayName
            : (existing?.displayName ?? "Deleted user"),
        // A Clerk deletion tombstones this external ID. A new account has a
        // different ID; an old upsert must never grant it access again.
        status:
          event.type === "user.delete" || existing?.status === "DEACTIVATED"
            ? "DEACTIVATED"
            : "ACTIVE",
        ...(event.type === "user.upsert" &&
        event.data.preferredLocale !== undefined
          ? { preferredLocale: event.data.preferredLocale }
          : existing?.preferredLocale === undefined
            ? {}
            : { preferredLocale: existing.preferredLocale }),
        ...(event.type === "user.delete"
          ? deletionWatermark(existing, event)
          : watermark(event)),
      });
    }
    return { outcome, entityKind: "USER", externalId: event.data.clerkUserId };
  }

  await provisionEmbeddedIdentity(event, port);
  const existing = await port.findMembership({
    clerkOrganizationId: event.data.clerkOrganizationId,
    clerkMembershipId: event.data.clerkMembershipId,
  });
  const ordered = outcomeFor(existing, event);
  const outcome =
    ordered === "STALE" &&
    event.type === "membership.delete" &&
    existing?.status !== "REVOKED"
      ? "APPLIED"
      : ordered;
  if (outcome === "APPLIED") {
    await port.putMembership({
      clerkOrganizationId: event.data.clerkOrganizationId,
      clerkUserId: event.data.clerkUserId,
      clerkMembershipId: event.data.clerkMembershipId,
      status:
        event.type === "membership.delete" || existing?.status === "REVOKED"
          ? "REVOKED"
          : "ACTIVE",
      scopeMode: existing?.scopeMode ?? "WAREHOUSE_SCOPED",
      effectiveFrom: existing?.effectiveFrom ?? event.eventAt,
      ...(existing?.effectiveTo === undefined
        ? {}
        : { effectiveTo: existing.effectiveTo }),
      ...(event.type === "membership.delete"
        ? deletionWatermark(existing, event)
        : watermark(event)),
    });
  }
  return {
    outcome,
    entityKind: "MEMBERSHIP",
    externalId: event.data.clerkMembershipId,
  };
}
