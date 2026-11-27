import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CUSTOMER_LINE_PERMISSION } from "../../convex/lib/permissions";
import { NAVIGATION_PERMISSION } from "../../convex/model/authorization/navigationPermissions";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexAuthorizationOptions,
} from "../fixtures/convex-tenant-world";

/**
 * Backend core of the customer LINE group integration, driven through the
 * internal transport seam with fabricated signed-event input. No credential,
 * provider call or real message is involved: `fetch` fails the test if used.
 */

const line = api.customerLine.groups;
const events = internal.customerLine.events;
const grantLineAccess = internal.customerLine.provision.grantOrgAdminLineAccess;

const lineId = (prefix: "U" | "C", seed: number) =>
  `${prefix}${seed.toString(16).padStart(32, "0")}`;
const BOT_A = lineId("U", 0xa);
const BOT_B = lineId("U", 0xb);
const BOT_C = lineId("U", 0xc);
const GROUP = lineId("C", 1);
const TEST_GROUP = lineId("C", 2);
const ALICE = lineId("U", 0x11);
const BOB = lineId("U", 0x12);
const CAROL = lineId("U", 0x13);
const T0 = 1_800_000_000_000;

const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../convex/**/*.ts",
      "!../../convex/_generated/**",
      "!../../convex/**/*.test.ts",
    ]),
  ).map(([path, load]) => [path.replace("../../convex/", "../convex/"), load]),
);

function value<T>(outcome: { ok: true; value: T } | { ok: false }): T {
  if (!outcome.ok) throw new Error("Expected an authorized LINE outcome");
  return outcome.value;
}

let sends: unknown[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  sends = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (...args: unknown[]) => {
      sends.push(args);
      throw new Error("No provider call is allowed in core tests");
    }),
  );
});
afterEach(() => {
  expect(sends).toEqual([]);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Event = {
  eventId: string;
  timestamp: number;
  groupId: string;
  type: "join" | "leave" | "memberJoined" | "memberLeft" | "message" | "unsend";
  senderId?: string;
  memberIds?: string[];
  messageId?: string;
  text?: string;
  mentionsSelf?: boolean;
  groupName?: string;
};

let sequence = 0;
const ev = (fields: Omit<Event, "eventId"> & { eventId?: string }): Event => ({
  eventId: `evt-${++sequence}`,
  ...fields,
});
const ask = (
  groupId: string,
  senderId: string,
  at: number,
  text = "@Yongkit where is my order?",
  mentionsSelf = true,
) =>
  ev({
    type: "message",
    groupId,
    senderId,
    timestamp: at,
    messageId: `m${++sequence}`,
    text,
    mentionsSelf,
  });

async function setup(options: ConvexAuthorizationOptions = {}) {
  const world = await createConvexTenantWorld(modules);
  const roles = await seedConvexAuthorization(world, {
    roleA: "ORG_ADMIN",
    ...options,
  });
  const upgrades = [
    await world.t.mutation(grantLineAccess, { orgId: world.orgA }),
    await world.t.mutation(grantLineAccess, { orgId: world.orgB }),
  ];
  const admin = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  const adminB = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_b",
  });
  const customer = async (
    orgId: Id<"organizations">,
    name: string,
  ): Promise<Id<"customers">> =>
    world.t.run((ctx) =>
      ctx.db.insert("customers", {
        orgId,
        code: name.toUpperCase(),
        name,
        normalizedName: name.toLowerCase(),
        status: "ACTIVE",
        version: 1,
        createdAt: 0,
        updatedAt: 0,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      }),
    );

  type Actor = typeof admin;
  const connect = async (actor: Actor, bot: string) => {
    const trusted = await actor.query(events.authorizeConnection, {});
    if (trusted === null) throw new Error("Expected a connection manager");
    return actor.mutation(events.saveConnection, {
      ...trusted,
      botUserId: bot,
      basicId: "@fixture",
      name: "Fixture OA",
      secretCiphertext: `sealed-verifier-${bot}`,
      tokenCiphertext: `sealed-sender-${bot}`,
      webhookKey: crypto.randomUUID(),
    });
  };
  const route = async (webhookPath: string) => {
    const found = await world.t.query(events.findConnection, {
      webhookKey: webhookPath.split("/").at(-1)!,
    });
    if (found === null) throw new Error("Expected a routable connection");
    return found;
  };
  const accept = async (webhookPath: string, batch: Event[]) => {
    const found = await route(webhookPath);
    return world.t.mutation(events.acceptEvents, {
      connectionId: found._id,
      revision: found.revision,
      destination: found.botUserId,
      events: batch,
    });
  };
  /** Connect, prove the webhook and finish the operator test send. */
  const activate = async (actor: Actor, bot: string) => {
    const saved = await connect(actor, bot);
    if (!saved.ok) throw new Error(`Connection refused: ${saved.code}`);
    const { webhookPath, _id: connectionId } = saved.connection;
    await accept(webhookPath, []);
    await accept(webhookPath, [
      ev({ type: "join", groupId: TEST_GROUP, timestamp: T0 }),
    ]);
    const test = value(await actor.query(line.listGroups, {})).page.find(
      ({ state }) => state === "pending",
    )!;
    const trusted = (await actor.query(events.authorizeConnection, {}))!;
    const target = { ...trusted, connectionId, groupId: test._id };
    const proof = await actor.query(events.readConnectionTest, target);
    expect(proof).toMatchObject({ to: TEST_GROUP });
    expect(
      await actor.mutation(events.finishConnectionTest, {
        ...target,
        revision: proof!.revision,
        groupVersion: proof!.groupVersion,
      }),
    ).toBe(true);
    return { connectionId, webhookPath };
  };
  /** A signed join plus staff approval for `customerId`. */
  const enroll = async (
    actor: Actor,
    webhookPath: string,
    customerId: Id<"customers">,
    groupId = GROUP,
    at = T0 + 10,
  ) => {
    await accept(webhookPath, [
      ev({ type: "join", groupId, timestamp: at, groupName: "Dispatch" }),
    ]);
    const pending = value(await actor.query(line.listGroups, {})).page.find(
      (group) => group.state === "pending" && group.name === "Dispatch",
    )!;
    expect(
      value(
        await actor.mutation(line.approveGroup, {
          groupId: pending._id,
          customerId,
          expectedVersion: pending.version,
          confirmed: true,
        }),
      ),
    ).toBeNull();
    return value(await actor.query(line.getGroup, { groupId: pending._id }))!;
  };
  const questions = async (actor: Actor, groupId: string) =>
    value(await actor.query(line.listQuestions, { groupId })).page;
  const contacts = async (actor: Actor, groupId: string) =>
    value(await actor.query(line.listContacts, { groupId })).page;
  const storedQuestions = () =>
    world.t.run((ctx) => ctx.db.query("customerLineQuestions").collect());

  return {
    ...world,
    roles,
    upgrades,
    admin,
    adminB,
    customer,
    connect,
    route,
    accept,
    activate,
    enroll,
    questions,
    contacts,
    storedQuestions,
  };
}

describe("customer LINE access", () => {
  it("opts an organization in without broadening customized or other roles", async () => {
    const world = await setup();
    expect(world.upgrades).toEqual([
      { status: "upgraded", added: 4 },
      { status: "upgraded", added: 4 },
    ]);
    expect(
      await world.t.mutation(grantLineAccess, { orgId: world.orgA }),
    ).toEqual({ status: "current", added: 0 });
    expect(value(await world.admin.query(line.viewer, {}))).toEqual({
      canRead: true,
      canManageGroups: true,
      canSend: true,
      canManageConnection: true,
    });
    const supervisor = await setup({ roleA: "SUPERVISOR" });
    expect((await supervisor.admin.query(line.viewer, {})).ok).toBe(false);
  });

  it("keeps LINE capabilities behind both customer read and the LINE grant", async () => {
    const world = await setup({
      roleA: "CUSTOMER_READER",
      extraRoles: [
        {
          key: "CUSTOMER_READER",
          permissionCodes: [NAVIGATION_PERMISSION.customers],
        },
      ],
    });
    expect(value(await world.admin.query(line.viewer, {}))).toEqual({
      canRead: false,
      canManageGroups: false,
      canSend: false,
      canManageConnection: false,
    });
    expect((await world.admin.query(line.listGroups, {})).ok).toBe(false);
    expect(await world.admin.query(events.authorizeConnection, {})).toBeNull();
    const reader = await setup({
      roleA: "LINE_READER",
      extraRoles: [
        {
          key: "LINE_READER",
          permissionCodes: [
            NAVIGATION_PERMISSION.customers,
            CUSTOMER_LINE_PERMISSION.read,
          ],
        },
      ],
    });
    expect(value(await reader.admin.query(line.viewer, {}))).toMatchObject({
      canRead: true,
      canSend: false,
      canManageConnection: false,
    });
    expect((await reader.admin.query(line.getPrimaryConnection, {})).ok).toBe(
      false,
    );
    expect(
      value(await reader.admin.query(line.getPrimaryConnectionSummary, {})),
    ).toBeNull();
  });
});

describe("customer LINE connections", () => {
  it("routes each OA independently and never adopts another organization's bot", async () => {
    const world = await setup();
    const a = await world.activate(world.admin, BOT_A);
    const b = await world.activate(world.adminB, BOT_B);
    expect(await world.connect(world.adminB, BOT_A)).toEqual({
      ok: false,
      code: "BOT_CLAIMED",
    });
    // A caller-supplied org or actor is compared, never trusted.
    const trustedA = (await world.admin.query(events.authorizeConnection, {}))!;
    expect(
      await world.admin.mutation(events.saveConnection, {
        ...trustedA,
        orgId: world.orgB,
        botUserId: BOT_C,
        basicId: "@x",
        name: "x",
        secretCiphertext: "s",
        tokenCiphertext: "t",
        webhookKey: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });

    const customerA = await world.customer(world.orgA, "Alpha");
    const customerB = await world.customer(world.orgB, "Bravo");
    // The same LINE group ID on two OAs is two unrelated enrollments.
    const groupA = await world.enroll(world.admin, a.webhookPath, customerA);
    const groupB = await world.enroll(world.adminB, b.webhookPath, customerB);
    expect(groupA._id).not.toBe(groupB._id);
    await world.accept(a.webhookPath, [ask(GROUP, ALICE, T0 + 20, "@Yk A?")]);
    expect((await world.questions(world.admin, groupA._id)).length).toBe(1);
    expect(await world.questions(world.adminB, groupB._id)).toEqual([]);
    const cross = await world.adminB.query(line.getGroup, {
      groupId: groupA._id,
    });
    expect(!cross.ok || cross.value === null).toBe(true);

    // Wrong destination or revision is stale: nothing is applied.
    const found = await world.route(a.webhookPath);
    for (const input of [
      { destination: BOT_B, revision: found.revision },
      { destination: BOT_A, revision: found.revision + 1 },
    ])
      expect(
        await world.t.mutation(events.acceptEvents, {
          connectionId: found._id,
          ...input,
          events: [ask(GROUP, ALICE, T0 + 30)],
        }),
      ).toEqual({ status: "stale", applied: 0, skipped: 0 });

    const summary = value(
      await world.admin.query(line.getPrimaryConnectionSummary, {}),
    );
    expect(summary).toEqual({
      name: "Fixture OA",
      basicId: "@fixture",
      state: "active",
    });
    const primary = value(
      await world.admin.query(line.getPrimaryConnection, {}),
    );
    expect(JSON.stringify(primary)).not.toMatch(/sealed|U0000/);

    // Replacing the OA keeps old groups on the old OA and stops their sends.
    const [question] = await world.questions(world.admin, groupA._id);
    expect(
      value(
        await world.admin.mutation(line.queueReply, {
          groupId: groupA._id,
          questionId: question!._id,
          text: "Shipped today.",
          confirmedAudience: true,
        }),
      ),
    ).toBeNull();
    const replaced = await world.connect(world.admin, BOT_C);
    expect(replaced.ok).toBe(true);
    expect(value(await world.admin.query(line.listGroups, {})).page).toEqual(
      [],
    );
    expect(
      await world.t.mutation(events.claimReply, { questionId: question!._id }),
    ).toBeNull();
    expect((await world.storedQuestions())[0]).toMatchObject({
      state: "canceled",
    });
    expect(
      await world.t.query(events.findConnection, {
        webhookKey: a.webhookPath.split("/").at(-1)!,
      }),
    ).toBeNull();
  });

  it("requires signed webhook proof and a pending signed-join group before a test send", async () => {
    const world = await setup();
    const saved = await world.connect(world.admin, BOT_A);
    if (!saved.ok) throw new Error("Expected a saved connection");
    const { webhookPath, _id: connectionId } = saved.connection;
    expect(saved.connection.state).toBe("setup");
    await world.accept(webhookPath, [
      ev({ type: "join", groupId: TEST_GROUP, timestamp: T0 }),
    ]);
    const trusted = (await world.admin.query(events.authorizeConnection, {}))!;
    const [test] = value(await world.admin.query(line.listGroups, {})).page;
    const target = { ...trusted, connectionId, groupId: test!._id };
    // The join itself was signed, so the route is proven; a forged actor is not.
    expect(
      await world.admin.query(events.readConnectionTest, {
        ...target,
        actorId: "forged",
      }),
    ).toBeNull();
    const proof = (await world.admin.query(events.readConnectionTest, target))!;
    // Reconnecting in between makes the proof stale.
    await world.connect(world.admin, BOT_A);
    expect(
      await world.admin.mutation(events.finishConnectionTest, {
        ...target,
        revision: proof.revision,
        groupVersion: proof.groupVersion,
      }),
    ).toBe(false);
    expect(
      value(await world.admin.query(line.getPrimaryConnection, {}))!.state,
    ).toBe("setup");
    // Same bot keeps its stable route.
    expect(
      value(await world.admin.query(line.getPrimaryConnection, {}))!
        .webhookPath,
    ).toBe(webhookPath);
  });
});

describe("customer LINE intake", () => {
  it("collects only bot mentions from active approved groups", async () => {
    const world = await setup();
    const { webhookPath } = await world.activate(world.admin, BOT_A);
    const customerId = await world.customer(world.orgA, "Alpha");
    await world.accept(webhookPath, [
      ev({
        type: "join",
        groupId: GROUP,
        timestamp: T0 + 10,
        groupName: "Dispatch",
      }),
      ask(GROUP, ALICE, T0 + 11),
    ]);
    // Pending: enrollment metadata only, no text or member is stored.
    expect(await world.storedQuestions()).toEqual([]);
    expect(
      await world.t.run((ctx) =>
        ctx.db.query("customerLineContacts").collect(),
      ),
    ).toEqual([]);
    expect(
      value(await world.admin.query(line.listGroups, {})).page.map(
        ({ state }) => state,
      ),
    ).toEqual(["pending", "pending"]);

    await world.t.run(async (ctx) => {
      const rows = await ctx.db.query("customerLineGroups").collect();
      expect(rows.filter((row) => row.lineGroupId === GROUP)).toHaveLength(1);
    });
    const group = await world.enroll(
      world.admin,
      webhookPath,
      customerId,
      GROUP,
      T0 + 10,
    );
    const dup = ask(GROUP, ALICE, T0 + 13, "@Yongkit first");
    expect(
      await world.accept(webhookPath, [
        ask(GROUP, ALICE, T0 + 12, "ordinary chatter", false),
        dup,
        dup,
        ask(GROUP, BOB, T0 + 14, "@Yongkit second"),
      ]),
    ).toEqual({ status: "ok", applied: 2, skipped: 2 });
    expect(
      (await world.questions(world.admin, group._id)).map(({ text }) => text),
    ).toEqual(["@Yongkit second", "@Yongkit first"]);
    expect(JSON.stringify(await world.storedQuestions())).not.toContain(
      "ordinary chatter",
    );

    expect(
      value(
        await world.admin.mutation(line.setGroupState, {
          groupId: group._id,
          expectedVersion: group.version,
          state: "paused",
        }),
      ),
    ).toBeNull();
    await world.accept(webhookPath, [ask(GROUP, ALICE, T0 + 15, "@Yk paused")]);
    expect(await world.questions(world.admin, group._id)).toHaveLength(2);
  });

  it("drops unsent questions, including when the unsend arrives first", async () => {
    const world = await setup();
    const { webhookPath } = await world.activate(world.admin, BOT_A);
    const group = await world.enroll(
      world.admin,
      webhookPath,
      await world.customer(world.orgA, "Alpha"),
    );
    const early = ask(GROUP, ALICE, T0 + 21, "@Yk early");
    const late = ask(GROUP, ALICE, T0 + 22, "@Yk late");
    await world.accept(webhookPath, [
      ev({
        type: "unsend",
        groupId: GROUP,
        timestamp: T0 + 23,
        messageId: early.messageId!,
      }),
      early,
      late,
    ]);
    expect(
      (await world.questions(world.admin, group._id)).map(({ text }) => text),
    ).toEqual(["@Yk late"]);
    await world.accept(webhookPath, [
      ev({
        type: "unsend",
        groupId: GROUP,
        timestamp: T0 + 24,
        messageId: late.messageId!,
      }),
    ]);
    expect(await world.storedQuestions()).toEqual([]);
  });
});

describe("customer LINE enrollment", () => {
  it("keeps the enrollment through member turnover and rejects stale, rejoined and archived scope", async () => {
    const world = await setup();
    const { webhookPath } = await world.activate(world.admin, BOT_A);
    const customerId = await world.customer(world.orgA, "Alpha");
    const group = await world.enroll(world.admin, webhookPath, customerId);
    await world.accept(webhookPath, [
      ask(GROUP, ALICE, T0 + 20),
      ask(GROUP, BOB, T0 + 21),
      ev({
        type: "memberLeft",
        groupId: GROUP,
        timestamp: T0 + 22,
        memberIds: [ALICE],
      }),
      ev({
        type: "memberJoined",
        groupId: GROUP,
        timestamp: T0 + 23,
        memberIds: [CAROL],
      }),
      ask(GROUP, CAROL, T0 + 24),
    ]);
    const after = value(
      await world.admin.query(line.getGroup, { groupId: group._id }),
    )!;
    expect(after).toMatchObject({
      _id: group._id,
      version: group.version,
      state: "active",
    });
    expect(
      (await world.contacts(world.admin, group._id)).map(({ name, state }) => [
        name,
        state,
      ]),
    ).toEqual([
      ["LINE member 1", "left"],
      ["LINE member 2", "observed"],
      ["LINE member 3", "observed"],
    ]);
    expect(await world.questions(world.admin, group._id)).toHaveLength(3);

    // A stale join (older than the current enrollment) is ignored.
    await world.accept(webhookPath, [
      ev({ type: "join", groupId: GROUP, timestamp: T0 + 5 }),
    ]);
    expect(
      value(await world.admin.query(line.getGroup, { groupId: group._id })),
    ).toMatchObject({ state: "active" });

    const [question] = await world.questions(world.admin, group._id);
    await world.accept(webhookPath, [
      ev({ type: "leave", groupId: GROUP, timestamp: T0 + 30 }),
    ]);
    const left = value(
      await world.admin.query(line.getGroup, { groupId: group._id }),
    )!;
    expect(left).toMatchObject({
      state: "disconnected",
      providerDeparture: "left",
    });
    for (const outcome of [
      await world.admin.mutation(line.setGroupState, {
        groupId: group._id,
        expectedVersion: left.version,
        state: "pending",
      }),
      await world.admin.mutation(line.queueReply, {
        groupId: group._id,
        questionId: question!._id,
        text: "Too late",
        confirmedAudience: true,
      }),
    ])
      expect(value(outcome)).toEqual({ code: "GROUP_STALE" });

    // Rejoin: a fresh pending enrollment that cannot reach the old history.
    await world.accept(webhookPath, [
      ev({
        type: "join",
        groupId: GROUP,
        timestamp: T0 + 40,
        groupName: "Dispatch",
      }),
    ]);
    expect(
      value(await world.admin.query(line.getGroup, { groupId: group._id })),
    ).toBeNull();
    const rejoined = value(
      await world.admin.query(line.listGroups, {}),
    ).page.find(({ name }) => name === "Dispatch")!;
    expect(rejoined).toMatchObject({ state: "pending", version: 1 });
    expect(rejoined).not.toHaveProperty("customerId");
    expect(await world.questions(world.admin, rejoined._id)).toEqual([]);
    expect(
      value(
        await world.admin.mutation(line.approveGroup, {
          groupId: group._id,
          customerId,
          expectedVersion: left.version,
          confirmed: true,
        }),
      ),
    ).toEqual({ code: "GROUP_STALE" });
    expect(
      value(
        await world.admin.mutation(line.approveGroup, {
          groupId: rejoined._id,
          customerId,
          expectedVersion: rejoined.version + 1,
          confirmed: true,
        }),
      ),
    ).toEqual({ code: "VERSION_CONFLICT" });

    // Archived customers cannot be approved, listed or answered.
    const archived = await world.customer(world.orgA, "Archived");
    await world.t.run((ctx) =>
      ctx.db.patch("customers", archived, { status: "ARCHIVED" }),
    );
    expect(
      value(
        await world.admin.mutation(line.approveGroup, {
          groupId: rejoined._id,
          customerId: archived,
          expectedVersion: rejoined.version,
          confirmed: true,
        }),
      ),
    ).toEqual({ code: "CUSTOMER_UNAVAILABLE" });
    value(
      await world.admin.mutation(line.approveGroup, {
        groupId: rejoined._id,
        customerId,
        expectedVersion: rejoined.version,
        confirmed: true,
      }),
    );
    await world.accept(webhookPath, [ask(GROUP, ALICE, T0 + 41)]);
    const [fresh] = await world.questions(world.admin, rejoined._id);
    expect(
      value(await world.admin.query(line.listGroups, { customerId })).page,
    ).toHaveLength(1);
    await world.t.run((ctx) =>
      ctx.db.patch("customers", customerId, { status: "ARCHIVED" }),
    );
    expect(
      value(await world.admin.query(line.listGroups, { customerId })).page,
    ).toEqual([]);
    expect(
      value(
        await world.admin.mutation(line.queueReply, {
          groupId: rejoined._id,
          questionId: fresh!._id,
          text: "Hello",
          confirmedAudience: true,
        }),
      ),
    ).toEqual({ code: "CUSTOMER_UNAVAILABLE" });
  });

  it("starts staff reapproval as a fresh enrollment isolated from earlier history", async () => {
    const world = await setup();
    const { webhookPath } = await world.activate(world.admin, BOT_A);
    const first = await world.customer(world.orgA, "First");
    const second = await world.customer(world.orgA, "Second");
    const group = await world.enroll(world.admin, webhookPath, first);
    await world.accept(webhookPath, [ask(GROUP, ALICE, T0 + 20)]);
    const restarted = value(
      await world.admin.mutation(line.setGroupState, {
        groupId: group._id,
        expectedVersion: group.version,
        state: "pending",
      }),
    );
    const [fresh] = value(
      await world.admin.query(line.listGroups, {}),
    ).page.filter(({ name }) => name === "Dispatch");
    expect(restarted).toEqual({ groupId: fresh!._id });
    expect(fresh!._id).not.toBe(group._id);
    vi.setSystemTime(T0 + 30);
    value(
      await world.admin.mutation(line.approveGroup, {
        groupId: fresh!._id,
        customerId: second,
        expectedVersion: fresh!.version,
        confirmed: true,
      }),
    );
    await world.accept(webhookPath, [ask(GROUP, BOB, T0 + 25)]);
    expect(await world.questions(world.admin, fresh!._id)).toEqual([]);
    expect(await world.contacts(world.admin, fresh!._id)).toEqual([]);
    expect(
      value(await world.admin.query(line.getGroup, { groupId: group._id })),
    ).toBeNull();
    expect(
      value(await world.admin.query(line.listGroups, { customerId: first }))
        .page,
    ).toEqual([]);
  });

  it("restarts a staff-disconnected group only as a fresh enrollment", async () => {
    const world = await setup();
    const { webhookPath } = await world.activate(world.admin, BOT_A);
    const customerId = await world.customer(world.orgA, "Alpha");
    const group = await world.enroll(world.admin, webhookPath, customerId);
    await world.accept(webhookPath, [ask(GROUP, ALICE, T0 + 20)]);
    value(
      await world.admin.mutation(line.setGroupState, {
        groupId: group._id,
        expectedVersion: group.version,
        state: "disconnected",
      }),
    );
    const off = value(
      await world.admin.query(line.getGroup, { groupId: group._id }),
    )!;
    expect(off).toMatchObject({ state: "disconnected" });
    expect(off).not.toHaveProperty("providerDeparture");
    expect(
      value(
        await world.admin.mutation(line.setGroupState, {
          groupId: group._id,
          expectedVersion: off.version,
          state: "active",
        }),
      ),
    ).toEqual({ code: "GROUP_DISCONNECTED" });
    const restarted = value(
      await world.admin.mutation(line.setGroupState, {
        groupId: group._id,
        expectedVersion: off.version,
        state: "pending",
      }),
    );
    const fresh = value(await world.admin.query(line.listGroups, {})).page.find(
      ({ name }) => name === "Dispatch",
    )!;
    expect(fresh).toMatchObject({ state: "pending", version: 1 });
    expect(restarted).toEqual({ groupId: fresh._id });
    expect(fresh._id).not.toBe(group._id);
    expect(
      value(await world.admin.query(line.getGroup, { groupId: group._id })),
    ).toBeNull();
    value(
      await world.admin.mutation(line.approveGroup, {
        groupId: fresh._id,
        customerId,
        expectedVersion: fresh.version,
        confirmed: true,
      }),
    );
    expect(await world.questions(world.admin, fresh._id)).toEqual([]);
  });

  it("verifies and revokes contacts independently of each other and of the group", async () => {
    const world = await setup();
    const { webhookPath } = await world.activate(world.admin, BOT_A);
    const group = await world.enroll(
      world.admin,
      webhookPath,
      await world.customer(world.orgA, "Alpha"),
    );
    await world.accept(webhookPath, [
      ask(GROUP, ALICE, T0 + 20),
      ask(GROUP, BOB, T0 + 21),
      ask(GROUP, CAROL, T0 + 22),
      ev({
        type: "memberLeft",
        groupId: GROUP,
        timestamp: T0 + 23,
        memberIds: [CAROL],
      }),
    ]);
    const [alice, bob, carol] = await world.contacts(world.admin, group._id);
    const set = (contactId: string, verified: boolean, name?: string) =>
      world.admin.mutation(line.setContact, {
        groupId: group._id,
        contactId,
        verified,
        ...(name === undefined ? {} : { name }),
      });
    expect(value(await set(alice!._id, true))).toEqual({
      code: "NAME_REQUIRED",
    });
    expect(value(await set(alice!._id, true, "  "))).toEqual({
      code: "INVALID_NAME",
    });
    expect(value(await set(carol!._id, true, "Carol"))).toEqual({
      code: "CONTACT_LEFT",
    });
    expect(value(await set(alice!._id, true, " Alice  Buyer "))).toBeNull();
    expect(value(await set(bob!._id, false))).toBeNull();
    expect(value(await set(carol!._id, false))).toBeNull();
    expect(
      (await world.contacts(world.admin, group._id)).map(({ name, state }) => [
        name,
        state,
      ]),
    ).toEqual([
      ["Alice Buyer", "verified"],
      ["LINE member 2", "revoked"],
      ["LINE member 3", "left"],
    ]);
    expect(
      value(await world.admin.query(line.getGroup, { groupId: group._id })),
    ).toMatchObject({
      state: "active",
    });
    // A revoked person's new mention is not taken in; others still are.
    await world.accept(webhookPath, [
      ask(GROUP, BOB, T0 + 30, "@Yk from bob"),
      ask(GROUP, ALICE, T0 + 31, "@Yk from alice"),
    ]);
    const latest = (await world.questions(world.admin, group._id))[0]!;
    expect(latest).toMatchObject({
      text: "@Yk from alice",
      senderLabel: "Alice Buyer",
    });
    expect(await world.questions(world.admin, group._id)).toHaveLength(4);
    await world.accept(webhookPath, [
      ev({
        type: "memberLeft",
        groupId: GROUP,
        timestamp: T0 + 32,
        memberIds: [ALICE],
      }),
      ev({
        type: "memberJoined",
        groupId: GROUP,
        timestamp: T0 + 33,
        memberIds: [ALICE],
      }),
      ask(GROUP, ALICE, T0 + 34),
    ]);
    expect((await world.contacts(world.admin, group._id))[0]).toMatchObject({
      name: "Alice Buyer",
      state: "revoked",
    });
    expect(await world.questions(world.admin, group._id)).toHaveLength(4);
    expect(value(await set(alice!._id, true, "Alice Buyer"))).toBeNull();
    await world.accept(webhookPath, [ask(GROUP, ALICE, T0 + 35)]);
    expect(await world.questions(world.admin, group._id)).toHaveLength(5);
  });
});

describe("customer LINE replies", () => {
  it("leases, authorizes and settles each independent question exactly once", async () => {
    const world = await setup();
    const { webhookPath } = await world.activate(world.admin, BOT_A);
    const customerId = await world.customer(world.orgA, "Alpha");
    const group = await world.enroll(world.admin, webhookPath, customerId);
    await world.accept(webhookPath, [
      ask(GROUP, ALICE, T0 + 20, "@Yk one"),
      ask(GROUP, BOB, T0 + 21, "@Yk two"),
      ask(GROUP, ALICE, T0 + 22, "@Yk three"),
    ]);
    const [three, two, one] = await world.questions(world.admin, group._id);
    const queue = (
      questionId: string,
      text: string,
      groupId: string = group._id,
    ) =>
      world.admin.mutation(line.queueReply, {
        groupId,
        questionId,
        text,
        confirmedAudience: true,
      });

    expect(value(await queue(one!._id, "Answer one"))).toBeNull();
    expect(
      (await world.questions(world.admin, group._id)).map(({ state }) => state),
    ).toEqual(["open", "open", "queued"]);
    const claim = (await world.t.mutation(events.claimReply, {
      questionId: one!._id,
    }))!;
    expect(claim).toMatchObject({
      to: GROUP,
      text: "Answer one",
      tokenCiphertext: `sealed-sender-${BOT_A}`,
    });
    expect(claim.retryKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await world.t.mutation(events.claimReply, { questionId: one!._id }),
    ).toBeNull();
    const lease = { questionId: one!._id, leaseId: claim.leaseId };
    expect(await world.t.query(events.authorizeReply, lease)).toBe(true);
    expect(
      await world.t.mutation(events.finishReply, {
        ...lease,
        leaseId: "other",
        state: "accepted",
      }),
    ).toBe(false);
    expect(
      await world.t.mutation(events.finishReply, {
        ...lease,
        state: "accepted",
        acceptedRequestId: "req-1",
      }),
    ).toBe(true);
    expect(
      await world.t.mutation(events.finishReply, { ...lease, state: "failed" }),
    ).toBe(false);
    expect(value(await queue(one!._id, "Again"))).toEqual({
      code: "QUESTION_NOT_OPEN",
    });

    // An expired lease is re-claimed with the same retry key; a failure after
    // an attempt that may have reached LINE stays uncertain.
    expect(value(await queue(two!._id, "Answer two"))).toBeNull();
    const firstTry = (await world.t.mutation(events.claimReply, {
      questionId: two!._id,
    }))!;
    vi.setSystemTime(Date.now() + 61_000);
    expect(
      await world.t.query(events.authorizeReply, {
        questionId: two!._id,
        leaseId: firstTry.leaseId,
      }),
    ).toBe(false);
    const secondTry = (await world.t.mutation(events.claimReply, {
      questionId: two!._id,
    }))!;
    expect(secondTry.retryKey).toBe(firstTry.retryKey);
    expect(
      await world.t.mutation(events.finishReply, {
        questionId: two!._id,
        leaseId: firstTry.leaseId,
        state: "accepted",
      }),
    ).toBe(false);
    await world.t.mutation(events.finishReply, {
      questionId: two!._id,
      leaseId: secondTry.leaseId,
      state: "failed",
    });
    const stateOf = async (id: string) =>
      (await world.questions(world.admin, group._id)).find(
        ({ _id }) => _id === id,
      )!.state;
    expect(await stateOf(two!._id)).toBe("unknown");
    expect(value(await queue(two!._id, "Different text"))).toEqual({
      code: "DELIVERY_UNCERTAIN",
    });
    expect(value(await queue(two!._id, "Answer two"))).toBeNull();
    const retry = (await world.t.mutation(events.claimReply, {
      questionId: two!._id,
    }))!;
    expect(retry.retryKey).toBe(firstTry.retryKey);

    // A reply is only for the group the question came from.
    const otherGroupId = lineId("C", 9);
    await world.accept(webhookPath, [
      ev({
        type: "join",
        groupId: otherGroupId,
        timestamp: T0 + 50,
        groupName: "Dispatch",
      }),
    ]);
    const other = value(await world.admin.query(line.listGroups, {})).page.find(
      ({ state, name }) => state === "pending" && name === "Dispatch",
    )!;
    value(
      await world.admin.mutation(line.approveGroup, {
        groupId: other._id,
        customerId,
        expectedVersion: other.version,
        confirmed: true,
      }),
    );
    expect(value(await queue(three!._id, "Wrong group", other._id))).toEqual({
      code: "QUESTION_NOT_FOUND",
    });

    // Pausing cancels a queued reply that transport has not claimed.
    expect(value(await queue(three!._id, "Answer three"))).toBeNull();
    const live = value(
      await world.admin.query(line.getGroup, { groupId: group._id }),
    )!;
    value(
      await world.admin.mutation(line.setGroupState, {
        groupId: group._id,
        expectedVersion: live.version,
        state: "paused",
      }),
    );
    expect(await stateOf(three!._id)).toBe("canceled");
    // The in-flight lease is refused at its pre-send check (version gate).
    expect(
      await world.t.query(events.authorizeReply, {
        questionId: two!._id,
        leaseId: retry.leaseId,
      }),
    ).toBe(false);

    // Scheduled deliveries run without any provider call for blocked work.
    await world.t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("rechecks the queuer's grant and the OA revision before each send", async () => {
    const world = await setup();
    const { webhookPath } = await world.activate(world.admin, BOT_A);
    const customerId = await world.customer(world.orgA, "Alpha");
    const group = await world.enroll(world.admin, webhookPath, customerId);
    await world.accept(webhookPath, [
      ask(GROUP, ALICE, T0 + 20, "@Yk a"),
      ask(GROUP, BOB, T0 + 21, "@Yk b"),
    ]);
    const [b, a] = await world.questions(world.admin, group._id);
    const queue = (questionId: string) =>
      world.admin.mutation(line.queueReply, {
        groupId: group._id,
        questionId,
        text: "Reviewed",
        confirmedAudience: true,
      });
    value(await queue(a!._id));
    const claim = (await world.t.mutation(events.claimReply, {
      questionId: a!._id,
    }))!;
    await world.t.run(async (ctx) => {
      const grant = await ctx.db
        .query("rolePermissions")
        .withIndex("by_orgId_roleId_permissionCode", (q) =>
          q
            .eq("orgId", world.orgA)
            .eq("roleId", world.roles.rolesA.get("ORG_ADMIN")!)
            .eq("permissionCode", CUSTOMER_LINE_PERMISSION.send),
        )
        .unique();
      await ctx.db.delete("rolePermissions", grant!._id);
    });
    expect(
      await world.t.query(events.authorizeReply, {
        questionId: a!._id,
        leaseId: claim.leaseId,
      }),
    ).toBe(false);
    expect((await queue(b!._id)).ok).toBe(false);
    await world.t.run(async (ctx) => {
      await ctx.db.insert("rolePermissions", {
        orgId: world.orgA,
        roleId: world.roles.rolesA.get("ORG_ADMIN")!,
        permissionCode: CUSTOMER_LINE_PERMISSION.send,
      });
    });
    value(await queue(b!._id));
    expect(
      value(
        await world.admin.mutation(api.customers.writes.archiveCustomer, {
          requestId: "line-test-archive",
          customerId,
          expectedVersion: 1,
        }),
      ),
    ).toMatchObject({ ok: true, customerId });
    expect(
      value(
        await world.admin.mutation(api.customers.writes.restoreCustomer, {
          requestId: "line-test-restore",
          customerId,
          expectedVersion: 2,
        }),
      ),
    ).toMatchObject({ ok: true, customerId });
    expect(
      await world.t.mutation(events.claimReply, { questionId: b!._id }),
    ).toBeNull();
    expect(
      (await world.questions(world.admin, group._id)).find(
        ({ _id }) => _id === b!._id,
      )!.state,
    ).toBe("canceled");
    // A fresh question queued after the restore is sendable again.
    await world.accept(webhookPath, [ask(GROUP, ALICE, T0 + 40, "@Yk c")]);
    const [c] = await world.questions(world.admin, group._id);
    expect(value(await queue(c!._id))).toBeNull();
    // Reconnecting the same bot never inherits replies queued before it.
    await world.connect(world.admin, BOT_A);
    expect(
      await world.t.mutation(events.claimReply, { questionId: c!._id }),
    ).toBeNull();
    expect(
      (await world.questions(world.admin, group._id)).find(
        ({ _id }) => _id === c!._id,
      )!.state,
    ).toBe("canceled");
    // Disconnecting the OA removes sealed material from every lookup.
    const primary = value(
      await world.admin.query(line.getPrimaryConnection, {}),
    )!;
    expect(
      value(
        await world.admin.mutation(line.disconnectConnection, {
          connectionId: primary._id,
        }),
      ),
    ).toBeNull();
    expect(
      await world.t.query(events.findConnection, {
        webhookKey: webhookPath.split("/").at(-1)!,
      }),
    ).toBeNull();
    await world.t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});
