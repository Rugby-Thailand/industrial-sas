import type { WebhookEvent } from "@clerk/backend/webhooks";

import {
  MAX_IDENTITY_DISPLAY_NAME_LENGTH,
  MAX_IDENTITY_REFERENCE_LENGTH,
  type IdentityWebhookEvent,
} from "./identityWebhook";

export interface ClerkWebhookDelivery {
  readonly eventId: string;
  /** Delivery timestamp in milliseconds. */
  readonly eventAt: number;
}

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

/**
 * A required field, bounded by the kernel's own published limit.
 *
 * The bound is enforced here, not only in the kernel, so a verified payload the
 * kernel would refuse is refused at the boundary as a terminal `400` instead of
 * surfacing as a `503` Clerk retries forever.
 */
function requiredString(value: unknown, max: number): string {
  if (typeof value !== "string") throw new InvalidClerkWebhookPayloadError();
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
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
  if (name.length > MAX_IDENTITY_DISPLAY_NAME_LENGTH) {
    throw new InvalidClerkWebhookPayloadError();
  }
  return name || `Clerk user ${clerkUserId}`;
}

function preferredLocale(value: unknown): "th" | "en" | undefined {
  if (typeof value !== "string") return undefined;
  const primary = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return primary === "th" || primary === "en" ? primary : undefined;
}

/**
 * Reduce a signature-verified Clerk event to the only fields the WMS mirror owns.
 * Unsupported event types deliberately return null without inspecting their data.
 */
export function normalizeVerifiedClerkEvent(
  event: Pick<WebhookEvent, "type" | "data">,
  delivery: ClerkWebhookDelivery,
): IdentityWebhookEvent | null {
  const envelope = {
    eventId: delivery.eventId,
    eventAt: delivery.eventAt,
  } as const;

  switch (event.type) {
    case "organization.created":
    case "organization.updated": {
      const data = record(event.data);
      return {
        ...envelope,
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
        ...envelope,
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
        ...envelope,
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
        ...envelope,
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
        ...envelope,
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
