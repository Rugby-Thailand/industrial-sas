import { verifyWebhook, type WebhookEvent } from "@clerk/backend/webhooks";
import {
  httpActionGeneric,
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";

import type {
  IdentityEventResult,
  IdentityWebhookEvent,
} from "./identityWebhook";
import {
  isValidIdentityText,
  MAX_IDENTITY_REFERENCE_LENGTH,
} from "./identityWebhook";
import { normalizeVerifiedClerkEvent } from "./clerkWebhookNormalizer";

type ApplyIdentityEvent = (
  event: IdentityWebhookEvent,
) => Promise<IdentityEventResult>;

export interface ClerkWebhookHandlerDependencies {
  readonly signingSecret: string | undefined;
  readonly verify?: (
    request: Request,
    options: { readonly signingSecret: string },
  ) => Promise<WebhookEvent>;
  readonly apply: ApplyIdentityEvent;
}

/**
 * The delivery identity Clerk signs alongside the body.
 *
 * `svix-id` is bounded and required to be non-empty here rather than merely
 * present: `headers.get` returns `""` for an empty header, and an unusable event
 * ID must fail as a terminal `400` rather than reach the mirror's watermark.
 */
function delivery(request: Request) {
  const eventId = request.headers.get("svix-id")?.trim();
  const timestamp = request.headers.get("svix-timestamp")?.trim();
  if (
    !isValidIdentityText(eventId, MAX_IDENTITY_REFERENCE_LENGTH) ||
    timestamp === undefined ||
    !/^\d+$/.test(timestamp)
  ) {
    throw new Error("Invalid delivery metadata.");
  }
  const eventAt = Number(timestamp) * 1_000;
  if (!Number.isSafeInteger(eventAt)) {
    throw new Error("Invalid delivery metadata.");
  }
  return { eventId, eventAt } as const;
}

const response = (status: number, body: string | null = null) =>
  new Response(body, {
    status,
    ...(body === null ? {} : { headers: { "content-type": "text/plain" } }),
  });

/** Signature-first, PII-silent HTTP boundary; dependencies keep it offline-testable. */
export function createClerkWebhookHandler(
  dependencies: ClerkWebhookHandlerDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (!dependencies.signingSecret) {
      return response(503, "Webhook unavailable.");
    }

    let verified: WebhookEvent;
    try {
      verified = await (dependencies.verify ?? verifyWebhook)(request, {
        signingSecret: dependencies.signingSecret,
      });
    } catch {
      return response(400, "Invalid webhook.");
    }

    let normalized: IdentityWebhookEvent | null;
    try {
      normalized = normalizeVerifiedClerkEvent(verified, delivery(request));
    } catch {
      return response(400, "Invalid webhook.");
    }
    if (normalized === null) return response(204);

    try {
      await dependencies.apply(normalized);
      return response(204);
    } catch {
      return response(503, "Webhook unavailable.");
    }
  };
}

type ApplyArgs = { readonly event: IdentityWebhookEvent };
const applyClerkIdentityEvent = makeFunctionReference<
  "mutation",
  ApplyArgs,
  IdentityEventResult
>(
  "lib/identityMirrorConvex:applyClerkIdentityEvent",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  ApplyArgs,
  IdentityEventResult
>;

/** Public only through the exact POST route in `convex/http.ts`. */
export const clerkWebhook = httpActionGeneric(
  async (ctx, request) =>
    await createClerkWebhookHandler({
      signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
      apply: async (event) =>
        await ctx.runMutation(applyClerkIdentityEvent, { event }),
    })(request),
);
