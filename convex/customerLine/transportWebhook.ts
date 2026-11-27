import { httpAction, type ActionCtx } from "../_generated/server";
import { LIMITS, WEBHOOK_PATH_PREFIX } from "./policy";
import {
  decryptLineCredential,
  lineSignature,
  verifyLineSignature,
} from "./transportCrypto";
import {
  boundedProviderId,
  boundedText,
  isLineGroupId,
  isLineUserId,
  isRetryKey,
  jsonRecord,
  LINE_MAX_WEBHOOK_BYTES,
  parseJson,
  readBoundedBody,
} from "./transportInput";
import {
  acceptEvents,
  findConnection,
  lookupGroupNames,
  type LineWebhookEvent,
} from "./transportReferences";

const maxGroupNameLookups = 5;

function normalizeEvent(value: unknown): LineWebhookEvent | null {
  const event = jsonRecord(value);
  const source = jsonRecord(event?.source);
  if (
    !event ||
    event.mode === "standby" ||
    source?.type !== "group" ||
    !isLineGroupId(source.groupId)
  ) {
    return null;
  }
  const eventId = boundedProviderId(event.webhookEventId);
  const timestamp = event.timestamp;
  if (
    !eventId ||
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    timestamp > Date.now() + 5 * 60_000
  ) {
    return null;
  }

  const common = { eventId, timestamp, groupId: source.groupId };
  switch (event.type) {
    case "join":
    case "leave":
      return { ...common, type: event.type };
    case "memberJoined":
    case "memberLeft": {
      const members = jsonRecord(
        event.type === "memberJoined" ? event.joined : event.left,
      )?.members;
      if (!Array.isArray(members) || members.length > LIMITS.memberIds)
        return null;
      const ids = members
        .map((member: unknown) => jsonRecord(member)?.userId)
        .filter(isLineUserId);
      if (ids.length === 0) return null;
      return { ...common, type: event.type, memberIds: [...new Set(ids)] };
    }
    case "message": {
      const message = jsonRecord(event.message);
      if (message?.type !== "text") return null;
      const mentionees = jsonRecord(message.mention)?.mentionees;
      if (
        !Array.isArray(mentionees) ||
        !mentionees.some(
          (mentionee: unknown) => jsonRecord(mentionee)?.isSelf === true,
        )
      ) {
        return null;
      }
      const messageId = boundedProviderId(message.id, LIMITS.lineId);
      const text = boundedText(message.text, LIMITS.questionText);
      if (!messageId || !text) return null;
      return {
        ...common,
        type: "message",
        messageId,
        mentionsSelf: true,
        text,
        ...(isLineUserId(source.userId) ? { senderId: source.userId } : {}),
      };
    }
    case "unsend": {
      const messageId = boundedProviderId(
        jsonRecord(event.unsend)?.messageId,
        LIMITS.lineId,
      );
      return messageId ? { ...common, type: event.type, messageId } : null;
    }
    default:
      return null;
  }
}

type WebhookContext = Pick<ActionCtx, "runQuery" | "runMutation" | "scheduler">;

export async function handleLineWebhook(
  ctx: WebhookContext,
  request: Request,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(WEBHOOK_PATH_PREFIX)) {
    return new Response(null, { status: 404 });
  }
  const webhookKey = path.slice(WEBHOOK_PATH_PREFIX.length);
  const signature = lineSignature(request.headers.get("x-line-signature"));
  if (!isRetryKey(webhookKey)) return new Response(null, { status: 404 });
  if (!signature) return new Response(null, { status: 401 });

  let body: Uint8Array<ArrayBuffer> | null;
  try {
    body = await readBoundedBody(request, LINE_MAX_WEBHOOK_BYTES);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (body === null) return new Response(null, { status: 413 });

  try {
    const connection = await ctx.runQuery(findConnection, { webhookKey });
    if (!connection) {
      return new Response(null, { status: 404 });
    }
    const secret = await decryptLineCredential(
      connection.secretCiphertext,
      "channel-secret",
      process.env.LINE_SECRETS_KEY,
    );
    if (!(await verifyLineSignature(body, signature, secret))) {
      return new Response(null, { status: 401 });
    }

    let payload: Record<string, unknown> | null;
    try {
      payload = jsonRecord(parseJson(body));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (
      !Array.isArray(payload?.events) ||
      payload.events.length > LIMITS.events
    ) {
      return new Response(null, { status: 400 });
    }
    if (payload.destination !== connection.botUserId) {
      return new Response(null, { status: 401 });
    }

    const events = (payload.events as unknown[])
      .map(normalizeEvent)
      .filter((event) => event !== null);
    if (events.length === 0 && payload.events.length > 0) {
      return new Response(null, { status: 200 });
    }
    const applied = await ctx.runMutation(acceptEvents, {
      connectionId: connection._id,
      destination: connection.botUserId,
      revision: connection.revision,
      events,
    });
    if (applied.status !== "ok") return new Response(null, { status: 503 });
    if (applied.applied > 0 && connection.tokenCiphertext) {
      const groups = events
        .filter(({ type }) => type === "join")
        .slice(0, maxGroupNameLookups)
        .map(({ groupId, timestamp }) => ({ groupId, timestamp }));
      if (groups.length > 0)
        await ctx.scheduler
          .runAfter(0, lookupGroupNames, {
            webhookKey,
            revision: connection.revision,
            groups,
          })
          .catch(() => undefined);
    }
    return new Response(null, { status: 200 });
  } catch {
    return new Response(null, { status: 503 });
  }
}

export const lineWebhook = httpAction(handleLineWebhook);
