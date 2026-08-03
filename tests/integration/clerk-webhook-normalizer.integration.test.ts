import type { WebhookEvent } from "@clerk/backend/webhooks";
import { describe, expect, it } from "vitest";

import {
  InvalidClerkWebhookPayloadError,
  normalizeVerifiedClerkEvent,
} from "../../convex/lib/clerkWebhookNormalizer";
import {
  MAX_IDENTITY_DISPLAY_NAME_LENGTH,
  MAX_IDENTITY_REFERENCE_LENGTH,
} from "../../convex/lib/identityWebhook";

const delivery = { eventId: "evt_fixture", eventAt: 1_000 } as const;
const event = (type: string, data: unknown) =>
  ({ type, data }) as Pick<WebhookEvent, "type" | "data">;

describe("Clerk event minimization", () => {
  it("maps organization lifecycle events without metadata", () => {
    expect(
      normalizeVerifiedClerkEvent(
        event("organization.updated", {
          id: "org_acme",
          name: "Acme",
          private_metadata: { billing: "private" },
          image_url: "https://example.test/logo.png",
        }),
        delivery,
      ),
    ).toEqual({
      ...delivery,
      type: "organization.upsert",
      data: { clerkOrganizationId: "org_acme", name: "Acme" },
    });
    expect(
      normalizeVerifiedClerkEvent(
        event("organization.deleted", {
          id: "org_acme",
          deleted: true,
          slug: "sensitive-slug",
        }),
        delivery,
      ),
    ).toEqual({
      ...delivery,
      type: "organization.delete",
      data: { clerkOrganizationId: "org_acme" },
    });
  });

  it("maps membership lifecycle events without Clerk roles or identifiers", () => {
    const raw = {
      id: "mem_nok_acme",
      role: "org:admin",
      permissions: ["private"],
      organization: {
        id: "org_acme",
        name: "Acme",
        private_metadata: { secret: true },
      },
      public_user_data: {
        user_id: "user_nok",
        first_name: null,
        last_name: null,
        identifier: "nok@example.test",
        image_url: "https://example.test/nok.png",
      },
    };

    for (const [clerkType, normalizedType] of [
      ["organizationMembership.created", "membership.upsert"],
      ["organizationMembership.updated", "membership.upsert"],
      ["organizationMembership.deleted", "membership.delete"],
    ] as const) {
      expect(
        normalizeVerifiedClerkEvent(event(clerkType, raw), delivery),
      ).toEqual({
        ...delivery,
        type: normalizedType,
        data: {
          clerkOrganizationId: "org_acme",
          name: "Acme",
          clerkUserId: "user_nok",
          displayName: "Clerk user user_nok",
          clerkMembershipId: "mem_nok_acme",
        },
      });
    }
  });

  it("does not inspect unsupported event data", () => {
    expect(
      normalizeVerifiedClerkEvent(event("session.created", null), delivery),
    ).toBeNull();
  });

  it("refuses strings the mirror kernel would refuse after the boundary", () => {
    expect(() =>
      normalizeVerifiedClerkEvent(
        event("organization.updated", {
          id: "org_acme",
          name: "ก".repeat(MAX_IDENTITY_DISPLAY_NAME_LENGTH + 1),
        }),
        delivery,
      ),
    ).toThrow(InvalidClerkWebhookPayloadError);
    expect(() =>
      normalizeVerifiedClerkEvent(
        event("organization.updated", {
          id: "o".repeat(MAX_IDENTITY_REFERENCE_LENGTH + 1),
          name: "Acme",
        }),
        delivery,
      ),
    ).toThrow(InvalidClerkWebhookPayloadError);
    expect(() =>
      normalizeVerifiedClerkEvent(
        event("user.updated", {
          id: "user_nok",
          first_name: "a".repeat(MAX_IDENTITY_DISPLAY_NAME_LENGTH),
          last_name: "b".repeat(MAX_IDENTITY_DISPLAY_NAME_LENGTH),
        }),
        delivery,
      ),
    ).toThrow(InvalidClerkWebhookPayloadError);
  });
});
