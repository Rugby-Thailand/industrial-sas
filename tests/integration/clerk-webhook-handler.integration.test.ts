import { Buffer } from "node:buffer";

import type { WebhookEvent } from "@clerk/backend/webhooks";
import { Webhook } from "svix";
import { describe, expect, it } from "vitest";

import { createClerkWebhookHandler } from "../../convex/lib/clerkWebhook";
import {
  MAX_IDENTITY_REFERENCE_LENGTH,
  type IdentityEventResult,
  type IdentityWebhookEvent,
} from "../../convex/lib/identityWebhook";

const SECRET = `whsec_${Buffer.from("industrial-ssa-test-signing-key").toString("base64")}`;

function signedRequest(
  payload: Readonly<Record<string, unknown>>,
  options: { readonly signature?: string } = {},
) {
  const body = JSON.stringify(payload);
  const eventId = "evt_signed_fixture";
  const timestamp = new Date();
  const signature =
    options.signature ?? new Webhook(SECRET).sign(eventId, timestamp, body);
  return new Request("https://example.test/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": eventId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1_000)),
      "svix-signature": signature,
    },
    body,
  });
}

const appliedResult: IdentityEventResult = {
  outcome: "APPLIED",
  entityKind: "USER",
  externalId: "user_nok",
};

describe("signed Clerk webhook HTTP boundary", () => {
  it("verifies a real signature before applying one PII-minimal normalized event", async () => {
    const applied: IdentityWebhookEvent[] = [];
    const handler = createClerkWebhookHandler({
      signingSecret: SECRET,
      apply: (event) => {
        applied.push(event);
        return Promise.resolve(appliedResult);
      },
    });
    const response = await handler(
      signedRequest({
        type: "user.created",
        data: {
          id: "user_nok",
          first_name: "Nok",
          last_name: "S.",
          locale: "th-TH",
          email_addresses: [{ email_address: "nok@example.test" }],
          private_metadata: { secret: "never mirror" },
          image_url: "https://example.test/private.png",
        },
        event_attributes: {
          http_request: { client_ip: "192.0.2.1", user_agent: "fixture" },
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual({
      eventId: "evt_signed_fixture",
      eventAt: expect.any(Number),
      type: "user.upsert",
      data: {
        clerkUserId: "user_nok",
        displayName: "Nok S.",
        preferredLocale: "th",
      },
    });
    expect(JSON.stringify(applied[0])).not.toMatch(
      /email|metadata|client_ip|user_agent|image|secret/i,
    );
  });

  it("rejects an invalid signature without normalizing or applying", async () => {
    const applied: IdentityWebhookEvent[] = [];
    const handler = createClerkWebhookHandler({
      signingSecret: SECRET,
      apply: (event) => {
        applied.push(event);
        return Promise.resolve(appliedResult);
      },
    });
    const response = await handler(
      signedRequest(
        {
          type: "user.created",
          data: { id: "user_nok", first_name: "Nok" },
        },
        { signature: "v1,invalid" },
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid webhook.");
    expect(applied).toEqual([]);
  });

  it("fails closed before verification when the signing secret is absent", async () => {
    let verified = false;
    const handler = createClerkWebhookHandler({
      signingSecret: undefined,
      verify: () => {
        verified = true;
        throw new Error("must not run");
      },
      apply: () => Promise.resolve(appliedResult),
    });
    const response = await handler(
      new Request("https://example.test/webhooks/clerk", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Webhook unavailable.");
    expect(verified).toBe(false);
  });

  it("acknowledges a verified unsupported event without touching the mirror", async () => {
    const applied: IdentityWebhookEvent[] = [];
    const handler = createClerkWebhookHandler({
      signingSecret: SECRET,
      apply: (event) => {
        applied.push(event);
        return Promise.resolve(appliedResult);
      },
    });
    const response = await handler(
      signedRequest({
        type: "session.created",
        data: { id: "sess_private", token: "never mirror" },
      }),
    );

    expect(response.status).toBe(204);
    expect(applied).toEqual([]);
  });

  it("rejects malformed supported data and hides transient apply failures", async () => {
    const malformed = createClerkWebhookHandler({
      signingSecret: SECRET,
      apply: () => Promise.resolve(appliedResult),
    });
    expect(
      (await malformed(signedRequest({ type: "user.created", data: {} })))
        .status,
    ).toBe(400);

    const unavailable = createClerkWebhookHandler({
      signingSecret: SECRET,
      apply: () => Promise.reject(new Error("private database detail")),
    });
    const response = await unavailable(
      signedRequest({
        type: "user.created",
        data: { id: "user_nok", first_name: "Nok" },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Webhook unavailable.");
  });

  it("rejects unusable delivery metadata as invalid, not as unavailable", async () => {
    const verified = {
      type: "user.created",
      data: { id: "user_nok", first_name: "Nok" },
    } as unknown as WebhookEvent;
    const applied: IdentityWebhookEvent[] = [];
    const handler = createClerkWebhookHandler({
      signingSecret: SECRET,
      verify: () => Promise.resolve(verified),
      apply: (event) => {
        applied.push(event);
        return Promise.resolve(appliedResult);
      },
    });
    const withEventId = async (eventId: string) =>
      await handler(
        new Request("https://example.test/webhooks/clerk", {
          method: "POST",
          headers: {
            "svix-id": eventId,
            "svix-timestamp": String(Math.floor(Date.now() / 1_000)),
          },
          body: "{}",
        }),
      );

    expect((await withEventId("")).status).toBe(400);
    expect(
      (await withEventId("e".repeat(MAX_IDENTITY_REFERENCE_LENGTH + 1))).status,
    ).toBe(400);
    expect(applied).toEqual([]);
    expect((await withEventId("evt_ok")).status).toBe(204);
    expect(applied).toHaveLength(1);
  });
});
