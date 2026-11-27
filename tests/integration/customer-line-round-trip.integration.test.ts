import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";
import { afterEach, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import { LIMITS } from "../../convex/customerLine/policy";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

const BOT = `U${"0".repeat(32)}`;
const GROUP = `C${"1".repeat(32)}`;
const ALICE = `U${"2".repeat(32)}`;
const BOB = `U${"3".repeat(32)}`;
const CHANNEL_SECRET = "signed-fixture-secret";
const ACCESS_TOKEN = "fixture-access-token";
const OTHER_BOT = `U${"4".repeat(32)}`;
const OTHER_GROUP = `C${"5".repeat(32)}`;
const OTHER_SECRET = "other-fixture-secret";
const OTHER_TOKEN = "other-fixture-token";

function value<T>(outcome: { ok: true; value: T } | { ok: false }): T {
  if (!outcome.ok) throw new Error("Expected authorized LINE fixture outcome");
  return outcome.value;
}

const text = (
  id: string,
  senderId: string,
  timestamp: number,
  mention: boolean,
) => ({
  type: "message",
  mode: "active",
  timestamp,
  webhookEventId: id,
  deliveryContext: { isRedelivery: false },
  source: { type: "group", groupId: GROUP, userId: senderId },
  message: {
    type: "text",
    id,
    text: "@Yongkit Where is the order?",
    ...(mention
      ? {
          mention: {
            mentionees: [
              { index: 0, length: 8, type: "user", isSelf: true, userId: BOT },
            ],
          },
        }
      : {}),
  },
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("sets up a test OA and routes reviewed replies from two employees back to their approved group", async () => {
  vi.useFakeTimers();
  vi.stubEnv("LINE_SECRETS_KEY", Buffer.alloc(32, 19).toString("base64"));
  let groupSummaryCalls = 0;
  const pushes: {
    to: string;
    text: string;
    key: string | null;
    secondary: boolean;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const request = new Request(input as RequestInfo | URL, init);
      const url = new URL(request.url);
      expect(url.origin).toBe("https://api.line.me");
      const credential = request.headers.get("authorization");
      expect(
        [ACCESS_TOKEN, OTHER_TOKEN].map((token) => `Bearer ${token}`),
      ).toContain(credential);
      const secondary = credential === `Bearer ${OTHER_TOKEN}`;
      const botId = secondary ? OTHER_BOT : BOT;
      const groupId = secondary ? OTHER_GROUP : GROUP;
      if (url.pathname === "/v2/bot/info") {
        return Response.json({
          userId: botId,
          basicId: "@fixture",
          displayName: "Fixture OA",
          chatMode: "bot",
          markAsReadMode: "auto",
        });
      }
      if (url.pathname === `/v2/bot/group/${groupId}/summary`) {
        groupSummaryCalls++;
        return Response.json({
          groupId,
          groupName: secondary ? "Receiving" : "Dispatch",
        });
      }
      expect(url.pathname).toBe("/v2/bot/message/push");
      const body = (await request.json()) as {
        to: string;
        messages: { text: string }[];
      };
      expect(body.to).toBe(groupId);
      pushes.push({
        secondary,
        to: body.to,
        text: body.messages[0]!.text,
        key: request.headers.get("x-line-retry-key"),
      });
      return Response.json(
        { sentMessages: [] },
        { headers: { "x-line-request-id": "fixture-accepted" } },
      );
    }),
  );

  const modules = Object.fromEntries(
    Object.entries(
      import.meta.glob([
        "../../convex/**/*.ts",
        "!../../convex/_generated/**",
        "!../../convex/**/*.test.ts",
      ]),
    ).map(([path, load]) => [
      path.replace("../../convex/", "../convex/"),
      load,
    ]),
  );
  const world = await createConvexTenantWorld(modules);
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  expect(
    await world.t.mutation(
      internal.customerLine.provision.grantOrgAdminLineAccess,
      { orgId: world.orgA },
    ),
  ).toEqual({ status: "upgraded", added: 4 });
  await world.t.mutation(
    internal.customerLine.provision.grantOrgAdminLineAccess,
    { orgId: world.orgB },
  );
  const user = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  const other = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_b",
  });
  const line = api.customerLine.groups;
  const transport = api.customerLine.transport;
  const customer = value(
    await user.mutation(api.customers.writes.createCustomer, {
      requestId: "line-customer",
      name: "Fixture customer",
    }),
  );
  if (!customer.ok) throw new Error("Expected to create the fixture customer");
  const connection = value(
    await user.action(transport.connectPrimary, {
      channelSecret: CHANNEL_SECRET,
      accessToken: ACCESS_TOKEN,
    }),
  );
  const additional = value(
    await user.action(internal.customerLine.transport.connectAdditional, {
      channelSecret: OTHER_SECRET,
      accessToken: OTHER_TOKEN,
    }),
  );
  expect(additional.webhookPath).not.toBe(connection.webhookPath);
  const deliver = async (
    events: object[],
    signature?: string,
    secondary = false,
  ) => {
    const body = JSON.stringify({
      destination: secondary ? OTHER_BOT : BOT,
      events,
    });
    const secret = secondary ? OTHER_SECRET : CHANNEL_SECRET;
    return world.t.fetch(
      secondary ? additional.webhookPath : connection.webhookPath,
      {
        method: "POST",
        body,
        headers: {
          "x-line-signature":
            signature ??
            createHmac("sha256", secret).update(body).digest("base64"),
        },
      },
    );
  };
  const now = Date.now();
  expect((await deliver([], "invalid")).ok).toBe(false);
  expect((await deliver([])).ok).toBe(true);
  const join = {
    type: "join",
    mode: "active",
    webhookEventId: "fixture-join",
    timestamp: now,
    source: { type: "group", groupId: GROUP },
  };
  const summaryCallsBeforeAck = groupSummaryCalls;
  expect((await deliver([join])).ok).toBe(true);
  expect(groupSummaryCalls).toBe(summaryCallsBeforeAck);
  const [pending] = value(await user.query(line.listGroups, {})).page;
  expect(pending).toMatchObject({ state: "pending" });
  if (!pending)
    throw new Error("Expected the signed join to create a pending group");
  const groupId = pending._id;
  expect(value(await user.query(line.listPendingGroups, {})).page).toEqual([]);
  expect(
    value(
      await user.mutation(line.approveGroup, {
        groupId,
        customerId: customer.customerId,
        expectedVersion: pending.version,
        confirmed: true,
      }),
    ),
  ).toEqual({ code: "CONNECTION_NOT_READY" });
  const additionalJoin = {
    ...join,
    source: { type: "group", groupId: OTHER_GROUP },
  };
  const wrongSignature = createHmac("sha256", CHANNEL_SECRET)
    .update(
      JSON.stringify({ destination: OTHER_BOT, events: [additionalJoin] }),
    )
    .digest("base64");
  expect((await deliver([additionalJoin], wrongSignature, true)).ok).toBe(
    false,
  );
  expect((await deliver([additionalJoin], undefined, true)).ok).toBe(true);
  const secondaryGroup = await world.t.run((ctx) =>
    ctx.db
      .query("customerLineGroups")
      .withIndex("by_orgId_connectionId_lineGroupId", (q) =>
        q
          .eq("orgId", world.orgA)
          .eq("connectionId", additional._id)
          .eq("lineGroupId", OTHER_GROUP),
      )
      .unique(),
  );
  if (!secondaryGroup)
    throw new Error("Expected a separate secondary enrollment");
  expect(
    value(await user.query(line.listGroups, {})).page.map(({ _id }) => _id),
  ).toEqual([groupId]);
  await expect(
    user.action(transport.testConnection, {
      connectionId: additional._id,
      groupId,
    }),
  ).rejects.toThrow(/LINE_TEST_TARGET_UNAVAILABLE/);
  expect(
    value(
      await user.action(transport.testConnection, {
        connectionId: additional._id,
        groupId: secondaryGroup._id,
      }),
    ),
  ).toBeNull();
  expect(pushes).toEqual([
    {
      to: OTHER_GROUP,
      text: expect.any(String),
      key: expect.any(String),
      secondary: true,
    },
  ]);
  expect((await deliver([text("pending", ALICE, now + 1, true)])).ok).toBe(
    true,
  );
  expect(value(await user.query(line.listQuestions, { groupId })).page).toEqual(
    [],
  );
  expect(
    value(
      await user.action(transport.testConnection, {
        connectionId: connection._id,
        groupId,
      }),
    ),
  ).toBeNull();
  expect(value(await user.query(line.listPendingGroups, {})).page).toEqual([
    {
      _id: groupId,
      name: pending.name,
      state: "pending",
      version: pending.version,
      lastActivityAt: now,
    },
  ]);
  const foreignJoinList = await other.query(line.listPendingGroups, {});
  expect(foreignJoinList.ok ? foreignJoinList.value.page : []).toEqual([]);
  expect(
    value(
      await user.mutation(line.approveGroup, {
        groupId,
        customerId: customer.customerId,
        expectedVersion: pending.version,
        confirmed: true,
      }),
    ),
  ).toBeNull();
  expect(value(await user.query(line.listPendingGroups, {})).page).toEqual([]);
  const afterApproval = Date.now();
  const first = text("first", ALICE, afterApproval + 2, true);
  const second = text("second", BOB, afterApproval + 3, true);
  expect(
    (
      await deliver([
        first,
        second,
        first,
        text("ordinary", ALICE, afterApproval + 4, false),
      ])
    ).ok,
  ).toBe(true);
  const requests = value(
    await user.query(line.listQuestions, { groupId }),
  ).page;
  expect(requests).toHaveLength(2);
  const otherGroup = await other.query(line.getGroup, { groupId });
  expect(!otherGroup.ok || otherGroup.value === null).toBe(true);
  for (const [index, request] of requests.entries()) {
    expect(
      value(
        await user.mutation(line.queueReply, {
          groupId,
          questionId: request._id,
          text: `Reviewed reply ${index + 1}`,
          confirmedAudience: true,
        }),
      ),
    ).toBeNull();
  }
  // Simulate a worker that never claimed the second reply by suppressing only
  // its immediate dispatch. The independent recovery dispatch remains queued.
  await world.t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    const immediate = jobs.filter(
      (job) =>
        job.name === "customerLine/transport:deliverReply" &&
        job.args[0]?.questionId === requests[1]!._id &&
        job.scheduledTime <= Date.now(),
    );
    expect(immediate).toHaveLength(1);
    await ctx.scheduler.cancel(immediate[0]!._id);
  });
  // The first worker does claim, then stops before sending. Its recovery
  // must reuse the original retry key.

  const abandoned = await world.t.mutation(
    internal.customerLine.events.claimReply,
    {
      questionId: requests[0]!._id,
    },
  );
  expect(abandoned).not.toBeNull();
  // Finish immediate work before moving the clock past its leases.
  await vi.advanceTimersByTimeAsync(1);
  await world.t.finishInProgressScheduledFunctions();
  expect(
    pushes.filter(({ text }) => text.startsWith("Reviewed reply")),
  ).toEqual([]);
  await vi.advanceTimersByTimeAsync(LIMITS.leaseMs + 1);
  await world.t.finishInProgressScheduledFunctions();
  expect(groupSummaryCalls).toBe(2);
  expect(value(await user.query(line.getGroup, { groupId }))).toMatchObject({
    name: "Dispatch",
  });
  const replies = pushes.filter((push) =>
    push.text.startsWith("Reviewed reply"),
  );
  expect(replies.map(({ to, secondary }) => [to, secondary])).toEqual([
    [GROUP, false],
    [GROUP, false],
  ]);
  expect(replies.map((reply) => reply.text).sort()).toEqual([
    "Reviewed reply 1",
    "Reviewed reply 2",
  ]);
  expect(new Set(replies.map((reply) => reply.key)).size).toBe(2);
  expect(replies.find(({ text }) => text === "Reviewed reply 1")?.key).toBe(
    abandoned!.retryKey,
  );
  expect(replies.every(({ key }) => Boolean(key))).toBe(true);
  expect(
    value(await user.query(line.listQuestions, { groupId })).page.map(
      ({ state }) => state,
    ),
  ).toEqual(["accepted", "accepted"]);
});
