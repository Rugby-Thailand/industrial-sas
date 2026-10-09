import type { WebhookEvent } from "@clerk/backend/webhooks";

import {
  MAX_IDENTITY_DISPLAY_NAME_LENGTH,
  MAX_IDENTITY_REFERENCE_LENGTH,
  isValidIdentityText,
  type IdentityWebhookEvent,
} from "./identityWebhook";

export interface ClerkWebhookDelivery {
  readonly eventId: string;
}

// The installed Clerk SDK omits timestamp from WebhookEvent's type even though
// it is part of Clerk's signed event envelope. Validate it as unknown at runtime.
type VerifiedClerkEvent = Pick<WebhookEvent, "type" | "data"> & {
  readonly timestamp?: unknown;
};

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export class InvalidClerkWebhookPayloadError extends Error {
  constructor() {
    super("The verified Clerk webhook payload is invalid.");
    this.name = "InvalidClerkWebhookPayloadError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidClerkWebhookPayloadError();
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, max: number): string {
  if (typeof value !== "string") throw new InvalidClerkWebhookPayloadError();
  const trimmed = value.trim();
  if (!isValidIdentityText(trimmed, max)) {
    throw new InvalidClerkWebhookPayloadError();
  }
  return trimmed;
}

function optionalName(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function displayName(
  firstName: unknown,
  lastName: unknown,
  clerkUserId: string,
): string {
  const name = [optionalName(firstName), optionalName(lastName)]
    .filter((part): part is string => part !== null)
    .join(" ");
  if (
    name.length > 0 &&
    !isValidIdentityText(name, MAX_IDENTITY_DISPLAY_NAME_LENGTH)
  ) {
    throw new InvalidClerkWebhookPayloadError();
  }
  return name || `Clerk user ${clerkUserId}`;
}

function preferredLocale(value: unknown): "th" | "en" | undefined {
  if (typeof value !== "string") return undefined;
  const primary = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return primary === "th" || primary === "en" ? primary : undefined;
}

function sourceClock(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > Date.now() + MAX_CLOCK_SKEW_MS
  ) {
    throw new InvalidClerkWebhookPayloadError();
  }
  return value;
}

function envelope(event: VerifiedClerkEvent, delivery: ClerkWebhookDelivery) {
  const eventTimestamp = sourceClock(event.timestamp);
  const data = record(event.data);
  // Deletion payloads can still carry the object's old updated_at; the deletion
  // itself is ordered by its event timestamp. Missing object clocks fall back
  // to that same signed timestamp. Never fall back to a delivery header.
  const eventAt =
    event.type.endsWith(".deleted") || data.updated_at === undefined
      ? eventTimestamp
      : sourceClock(data.updated_at);
  if (eventAt > eventTimestamp) throw new InvalidClerkWebhookPayloadError();
  return { eventId: delivery.eventId, eventAt, eventTimestamp } as const;
}

export function normalizeVerifiedClerkEvent(
  event: VerifiedClerkEvent,
  delivery: ClerkWebhookDelivery,
): IdentityWebhookEvent | null {
  switch (event.type) {
    case "organization.created":
    case "organization.updated": {
      const data = record(event.data);
      return {
        ...envelope(event, delivery),
        type: "organization.upsert",
        data: {
          clerkOrganizationId: requiredString(
            data.id,
            MAX_IDENTITY_REFERENCE_LENGTH,
          ),
          name: requiredString(data.name, MAX_IDENTITY_DISPLAY_NAME_LENGTH),
        },
      };
    }
    case "organization.deleted": {
      const data = record(event.data);
      return {
        ...envelope(event, delivery),
        type: "organization.delete",
        data: {
          clerkOrganizationId: requiredString(
            data.id,
            MAX_IDENTITY_REFERENCE_LENGTH,
          ),
        },
      };
    }
    case "user.created":
    case "user.updated": {
      const data = record(event.data);
      const clerkUserId = requiredString(
        data.id,
        MAX_IDENTITY_REFERENCE_LENGTH,
      );
      const locale = preferredLocale(data.locale);
      return {
        ...envelope(event, delivery),
        type: "user.upsert",
        data: {
          clerkUserId,
          displayName: displayName(
            data.first_name,
            data.last_name,
            clerkUserId,
          ),
          ...(locale === undefined ? {} : { preferredLocale: locale }),
        },
      };
    }
    case "user.deleted": {
      const data = record(event.data);
      return {
        ...envelope(event, delivery),
        type: "user.delete",
        data: {
          clerkUserId: requiredString(data.id, MAX_IDENTITY_REFERENCE_LENGTH),
        },
      };
    }
    case "organizationMembership.created":
    case "organizationMembership.updated":
    case "organizationMembership.deleted": {
      const data = record(event.data);
      const organization = record(data.organization);
      const publicUserData = record(data.public_user_data);
      const clerkUserId = requiredString(
        publicUserData.user_id,
        MAX_IDENTITY_REFERENCE_LENGTH,
      );
      return {
        ...envelope(event, delivery),
        type:
          event.type === "organizationMembership.deleted"
            ? "membership.delete"
            : "membership.upsert",
        data: {
          clerkOrganizationId: requiredString(
            organization.id,
            MAX_IDENTITY_REFERENCE_LENGTH,
          ),
          name: requiredString(
            organization.name,
            MAX_IDENTITY_DISPLAY_NAME_LENGTH,
          ),
          clerkUserId,
          displayName: displayName(
            publicUserData.first_name,
            publicUserData.last_name,
            clerkUserId,
          ),
          clerkMembershipId: requiredString(
            data.id,
            MAX_IDENTITY_REFERENCE_LENGTH,
          ),
        },
      };
    }
    default:
      return null;
  }
}
