import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import {
  internalMutation,
  internalQuery,
  query,
} from "../../convex/_generated/server";
import { WEBHOOK_PATH_PREFIX } from "../../convex/customerLine/policy";
import {
  decryptLineCredential,
  encryptLineCredential,
} from "../../convex/customerLine/transportCrypto";
import { LINE_MAX_WEBHOOK_BYTES } from "../../convex/customerLine/transportInput";
import {
  deliverLineReply,
  pushLineGroupMessage,
} from "../../convex/customerLine/transportProvider";

const secret = "line-channel-secret-fixture";
const token = "line-access-token-fixture";
const secretsKey = Buffer.alloc(32, 37).toString("base64");
const bot = `U${"1".repeat(32)}`;
const sender = `U${"2".repeat(32)}`;
const group = `C${"3".repeat(32)}`;
const key = "a84c0023-05dd-4ee8-ae71-10643dab62fb";
const webhook = `${WEBHOOK_PATH_PREFIX}${key}`;
const message = { to: group, text: "Reviewed reply", retryKey: key };
const readinessTarget = { connectionId: "connection", groupId: "group" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function webhookFixture() {
  vi.stubEnv("LINE_SECRETS_KEY", secretsKey);
  const secretCiphertext = await encryptLineCredential(
    secret,
    "channel-secret",
    secretsKey,
  );
  const processed = vi.fn();
  const lookup = vi.fn();
  const findConnection = internalQuery({
    args: { webhookKey: v.string() },
    handler: (_ctx, args) => {
      lookup(args.webhookKey);
      return args.webhookKey === key
        ? {
            _id: "connection",
            botUserId: bot,
            revision: 3,
            secretCiphertext,
            state: "setup",
          }
        : null;
    },
  });
  const acceptEvents = internalMutation({
    args: {
      connectionId: v.string(),
      destination: v.string(),
      revision: v.number(),
      events: v.array(v.any()),
    },
    handler: (_ctx, args) => {
      processed(args);
      return { status: "ok", applied: args.events.length, skipped: 0 };
    },
  });
  const test = convexTest({
    modules: {
      "../convex/_generated/server.js": async () => ({}),
      "../convex/http.ts": () => import("../../convex/http"),
      "../convex/customerLine/events.ts": async () => ({
        findConnection,
        acceptEvents,
      }),
    },
  });
  const post = (body: string, signature = sign(body)) =>
    test.fetch(webhook, {
      method: "POST",
      body,
      headers: { "x-line-signature": signature },
    });
  return { post, lookup, processed };
}

function sign(body: string) {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("signed LINE webhook", () => {
  it("verifies the exact bytes and the intended OA before accepting signed readiness proof", async () => {
    const { post, processed } = await webhookFixture();
    const empty = `{"destination":"${bot}", "events":[] }\n`;
    expect((await post(empty, sign(empty.trim()))).status).toBe(401);
    expect((await post('{"destination":"elsewhere","events":[]}')).status).toBe(
      401,
    );
    expect(processed).not.toHaveBeenCalled();
    expect((await post(empty)).status).toBe(200);
    expect(processed).toHaveBeenCalledExactlyOnceWith({
      connectionId: "connection",
      destination: bot,
      revision: 3,
      events: [],
    });
  });

  it("accepts only actual OA mentions and normalized group lifecycle events", async () => {
    const { post, processed } = await webhookFixture();
    const timestamp = Date.now();
    const source = { type: "group", groupId: group, userId: sender };
    const text = {
      type: "message",
      webhookEventId: "mentioned",
      timestamp,
      source,
      replyToken: "ignored-reply-token",
      message: {
        id: "sender-message",
        type: "text",
        text: "@Fixture ขอทราบสถานะงาน",
        mention: { mentionees: [{ type: "user", isSelf: true }] },
      },
    };
    const events = [
      text,
      {
        ...text,
        webhookEventId: "ordinary",
        message: { ...text.message, mention: undefined },
      },
      {
        ...text,
        webhookEventId: "other-mention",
        message: {
          ...text.message,
          mention: { mentionees: [{ userId: bot, isSelf: false }] },
        },
      },
      {
        ...text,
        webhookEventId: "media",
        message: { ...text.message, type: "image" },
      },
      {
        ...text,
        webhookEventId: "direct",
        source: { type: "user", userId: sender },
      },
      { ...text, webhookEventId: "standby", mode: "standby" },
      {
        type: "join",
        webhookEventId: "joined",
        timestamp,
        source,
        groupName: "untrusted",
      },
      {
        type: "unsend",
        webhookEventId: "unsent",
        timestamp,
        source,
        unsend: { messageId: "sender-message" },
      },
    ];
    expect(
      (await post(JSON.stringify({ destination: bot, events }))).status,
    ).toBe(200);
    expect(processed).toHaveBeenCalledExactlyOnceWith({
      connectionId: "connection",
      destination: bot,
      revision: 3,
      events: [
        {
          type: "message",
          eventId: "mentioned",
          timestamp,
          groupId: group,
          senderId: sender,
          messageId: "sender-message",
          mentionsSelf: true,
          text: text.message.text,
        },
        { type: "join", eventId: "joined", timestamp, groupId: group },
        {
          type: "unsend",
          eventId: "unsent",
          timestamp,
          groupId: group,
          messageId: "sender-message",
        },
      ],
    });
  });

  it("rejects unsigned and oversized requests before a route lookup", async () => {
    const { post, lookup, processed } = await webhookFixture();
    expect((await post("{}", "invalid")).status).toBe(401);
    expect((await post("a".repeat(LINE_MAX_WEBHOOK_BYTES + 1))).status).toBe(
      413,
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(processed).not.toHaveBeenCalled();
  });
});

describe("LINE provider boundary", () => {
  it("retries an uncertain group push with the same payload and key and records the original acceptance", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 409,
          headers: {
            "x-line-request-id": "retry-request",
            "x-line-accepted-request-id": "original-request",
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const authorize = vi.fn(async () => true);
    expect(await deliverLineReply(token, message, authorize)).toEqual({
      state: "accepted",
      acceptedRequestId: "original-request",
    });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetch.mock.calls) {
      const request = new Request(url, options);
      expect(request.url).toBe("https://api.line.me/v2/bot/message/push");
      expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(request.headers.get("x-line-retry-key")).toBe(key);
      expect(request.redirect).toBe("error");
      expect(await request.json()).toEqual({
        to: group,
        messages: [{ type: "text", text: message.text }],
      });
    }
  });

  it("keeps uncertainty after a definite retry rejection or when reauthorization blocks the retry", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error("simulated connection reset"))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    expect(await deliverLineReply(token, message, async () => true)).toEqual({
      state: "unknown",
    });
    const authorize = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    expect(await deliverLineReply(token, message, authorize)).toEqual({
      state: "unknown",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      await deliverLineReply(token, message, async () => false),
    ).toBeNull();
    expect(await pushLineGroupMessage(token, { ...message, to: bot })).toEqual({
      state: "failed",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("aborts a stalled provider call and marks its acceptance unknown", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(options.signal?.reason),
          );
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = pushLineGroupMessage(token, message);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toEqual({ state: "unknown" });
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("seals credentials with randomized encryption and binds ciphertext to the credential type", async () => {
    const encrypted = await encryptLineCredential(
      token,
      "access-token",
      secretsKey,
    );
    expect(encrypted).not.toContain(token);
    expect(
      await encryptLineCredential(token, "access-token", secretsKey),
    ).not.toBe(encrypted);
    expect(
      await decryptLineCredential(encrypted, "access-token", secretsKey),
    ).toBe(token);
    await expect(
      decryptLineCredential(encrypted, "channel-secret", secretsKey),
    ).rejects.toThrow();
    await expect(
      decryptLineCredential(encrypted, "access-token", undefined),
    ).rejects.toThrow();
  });
});

async function readinessFixture() {
  vi.stubEnv("LINE_SECRETS_KEY", secretsKey);
  const tokenCiphertext = await encryptLineCredential(
    token,
    "access-token",
    secretsKey,
  );
  const actor = { orgId: "trustedorg", actorId: "staffactor" };
  const target = vi.fn(
    async (): Promise<{
      to: string;
      tokenCiphertext: string;
      revision: number;
      groupVersion: number;
    } | null> => ({
      to: group,
      tokenCiphertext,
      revision: 3,
      groupVersion: 2,
    }),
  );
  const recordProof = vi.fn();
  const testArgs = {
    orgId: v.string(),
    actorId: v.string(),
    connectionId: v.string(),
    groupId: v.string(),
  };
  const t = convexTest({
    modules: {
      "../convex/_generated/server.js": async () => ({}),
      "../convex/customerLine/transport.ts": () =>
        import("../../convex/customerLine/transport"),
      "../convex/customerLine/groups.ts": async () => ({
        viewer: query({
          args: {},
          handler: async (ctx) => ({
            ok: true,
            value: {
              canManageConnection:
                (await ctx.auth.getUserIdentity())?.subject === "staff",
            },
          }),
        }),
      }),
      "../convex/customerLine/events.ts": async () => ({
        authorizeConnection: internalQuery({
          args: {},
          handler: async (ctx) =>
            (await ctx.auth.getUserIdentity())?.subject === "staff"
              ? actor
              : null,
        }),
        readConnectionTest: internalQuery({
          args: testArgs,
          handler: (_ctx, args) => {
            expect(args).toEqual({ ...actor, ...readinessTarget });
            return target();
          },
        }),
        finishConnectionTest: internalMutation({
          args: { ...testArgs, revision: v.number(), groupVersion: v.number() },
          handler: (_ctx, args) => {
            recordProof(args);
            return true;
          },
        }),
      }),
    },
  });
  return { t, actor, target, recordProof };
}

describe("LINE readiness action", () => {
  it("denies unauthorized callers and skips a group that changed before the send", async () => {
    const { t, target, recordProof } = await readinessFixture();
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const action = api.customerLine.transport.testConnection;
    expect(await t.action(action, readinessTarget)).toMatchObject({
      ok: false,
    });
    expect(
      await t
        .withIdentity({ subject: "viewer" })
        .action(action, readinessTarget),
    ).toMatchObject({ ok: false });
    expect(target).not.toHaveBeenCalled();

    const initial = await target();
    target.mockClear();
    target.mockResolvedValueOnce(initial).mockResolvedValueOnce(null);
    await expect(
      t.withIdentity({ subject: "staff" }).action(action, readinessTarget),
    ).rejects.toThrow("LINE_TEST_TARGET_UNAVAILABLE");
    expect(target).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(recordProof).not.toHaveBeenCalled();
  });

  it("sends only the neutral test to the selected group and records proof on acceptance", async () => {
    const { t, actor, recordProof } = await readinessFixture();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const staff = t.withIdentity({ subject: "staff" });
    const action = api.customerLine.transport.testConnection;
    await expect(staff.action(action, readinessTarget)).rejects.toThrow(
      "LINE_TEST_UNCONFIRMED",
    );
    expect(recordProof).not.toHaveBeenCalled();
    expect(await staff.action(action, readinessTarget)).toMatchObject({
      ok: true,
      value: null,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(await new Request(url, init).json()).toEqual({
        to: group,
        messages: [
          { type: "text", text: "ข้อความทดสอบการเชื่อมต่อ LINE จาก Yongkit" },
        ],
      });
    }
    expect(recordProof).toHaveBeenCalledExactlyOnceWith({
      ...actor,
      ...readinessTarget,
      revision: 3,
      groupVersion: 2,
    });
  });
});
