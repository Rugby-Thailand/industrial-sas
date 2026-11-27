"use node";

import { ConvexError, v, type Validator } from "convex/values";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { toPublicAuthorizationDenial } from "../lib/authorization";
import { mintRequestId } from "../lib/tenantFunctions";
import {
  decryptLineCredential,
  encryptLineCredential,
  lineCredential,
} from "./transportCrypto";
import { isLocalId } from "./transportInput";
import {
  deliverLineReply,
  getLineBotInfo,
  getLineGroupName,
  pushLineGroupMessage,
} from "./transportProvider";
import {
  authorizeConnection,
  authorizeReply,
  claimReply,
  finishConnectionTest,
  finishReply,
  findConnection,
  lineViewer,
  readConnectionTest,
  saveConnection,
  updateGroupNames,
} from "./transportReferences";
import { connectionView } from "./validators";

const TEST_MESSAGE = "ข้อความทดสอบการเชื่อมต่อ LINE จาก Yongkit";

function outcome<Value>(value: Validator<Value, "required", string>) {
  return v.union(
    v.object({ ok: v.literal(true), requestId: v.string(), value }),
    v.object({
      ok: v.literal(false),
      requestId: v.string(),
      denial: v.object({
        kind: v.literal("AUTHORIZATION_DENIED"),
        code: v.literal("AUTHORIZATION_DENIED"),
        requestId: v.string(),
        message: v.string(),
      }),
    }),
  );
}

async function currentConnectionActor(ctx: ActionCtx) {
  if (!(await ctx.auth.getUserIdentity())) return null;
  const viewer = await ctx.runQuery(lineViewer, {});
  if (!viewer.ok || !viewer.value.canManageConnection) {
    return null;
  }
  return await ctx.runQuery(authorizeConnection, {});
}

function denied(requestId: string) {
  return {
    ok: false as const,
    requestId,
    denial: toPublicAuthorizationDenial(requestId),
  };
}

function lineFailure(code: string, requestId: string) {
  return new ConvexError({ code, requestId });
}

async function connectAccount(
  ctx: ActionCtx,
  args: { channelSecret: string; accessToken: string },
  primary: boolean,
) {
  const requestId = mintRequestId();
  const actor = await currentConnectionActor(ctx).catch(() => null);
  if (!actor) return denied(requestId);
  const channelSecret = lineCredential(args.channelSecret, "channel-secret");
  const accessToken = lineCredential(args.accessToken, "access-token");
  if (!channelSecret || !accessToken) {
    throw lineFailure("LINE_CREDENTIALS_INVALID", requestId);
  }

  const envKey = process.env.LINE_SECRETS_KEY;
  const [secretCiphertext, tokenCiphertext] = await Promise.all([
    encryptLineCredential(channelSecret, "channel-secret", envKey),
    encryptLineCredential(accessToken, "access-token", envKey),
  ]).catch(() => {
    throw lineFailure("LINE_STORAGE_UNAVAILABLE", requestId);
  });
  const info = await getLineBotInfo(accessToken).catch(() => {
    throw lineFailure("LINE_PROVIDER_UNAVAILABLE", requestId);
  });
  if (!info) throw lineFailure("LINE_BOT_VERIFICATION_FAILED", requestId);

  const result = await ctx
    .runMutation(saveConnection, {
      ...actor,
      ...info,
      secretCiphertext,
      tokenCiphertext,
      webhookKey: crypto.randomUUID(),
      primary,
    })
    .catch(() => {
      throw lineFailure("LINE_CONNECTION_UNAVAILABLE", requestId);
    });
  if (!result.ok) {
    if (result.code === "FORBIDDEN") return denied(requestId);
    throw lineFailure("LINE_CONNECTION_UNAVAILABLE", requestId);
  }
  return { ok: true as const, requestId, value: result.connection };
}

const accountCredentials = {
  channelSecret: v.string(),
  accessToken: v.string(),
};

export const connectPrimary = action({
  args: accountCredentials,
  returns: outcome(connectionView),
  handler: (ctx, args) => connectAccount(ctx, args, true),
});

export const connectAdditional = internalAction({
  args: accountCredentials,
  returns: outcome(connectionView),
  handler: (ctx, args) => connectAccount(ctx, args, false),
});

export const testConnection = action({
  args: { connectionId: v.string(), groupId: v.string() },
  returns: outcome(v.null()),
  handler: async (ctx, args) => {
    const requestId = mintRequestId();
    const actor = await currentConnectionActor(ctx).catch(() => null);
    if (!actor) return denied(requestId);
    if (!isLocalId(args.connectionId) || !isLocalId(args.groupId)) {
      throw lineFailure("LINE_TEST_TARGET_UNAVAILABLE", requestId);
    }
    const target = { ...actor, ...args };
    const initial = await ctx
      .runQuery(readConnectionTest, target)
      .catch(() => null);
    if (!initial) throw lineFailure("LINE_TEST_TARGET_UNAVAILABLE", requestId);
    const token = await decryptLineCredential(
      initial.tokenCiphertext,
      "access-token",
      process.env.LINE_SECRETS_KEY,
    ).catch(() => {
      throw lineFailure("LINE_STORAGE_UNAVAILABLE", requestId);
    });

    const current = await ctx
      .runQuery(readConnectionTest, target)
      .catch(() => null);
    if (
      !current ||
      initial.revision !== current.revision ||
      initial.groupVersion !== current.groupVersion ||
      initial.to !== current.to
    ) {
      throw lineFailure("LINE_TEST_TARGET_UNAVAILABLE", requestId);
    }
    const result = await pushLineGroupMessage(token, {
      to: current.to,
      text: TEST_MESSAGE,
      retryKey: crypto.randomUUID(),
    });
    if (result.state !== "accepted") {
      throw lineFailure(
        result.state === "unknown"
          ? "LINE_TEST_UNCONFIRMED"
          : "LINE_TEST_FAILED",
        requestId,
      );
    }

    const recorded = await ctx
      .runMutation(finishConnectionTest, {
        ...target,
        revision: current.revision,
        groupVersion: current.groupVersion,
      })
      .catch(() => false);
    if (!recorded) throw lineFailure("LINE_TEST_PROOF_UNAVAILABLE", requestId);
    return { ok: true as const, requestId, value: null };
  },
});

/** Optional names load after acknowledging the signed join. */
export const lookupGroupNames = internalAction({
  args: {
    webhookKey: v.string(),
    revision: v.number(),
    groups: v.array(v.object({ groupId: v.string(), timestamp: v.number() })),
  },
  returns: v.null(),
  handler: async (ctx, { webhookKey, revision, groups }) => {
    if (groups.length > 5) return null;
    const connection = await ctx.runQuery(findConnection, { webhookKey });
    if (!connection?.tokenCiphertext || connection.revision !== revision)
      return null;
    const token = await decryptLineCredential(
      connection.tokenCiphertext,
      "access-token",
      process.env.LINE_SECRETS_KEY,
    ).catch(() => null);
    if (!token) return null;
    const summaries = await Promise.all(
      groups.map(async (group) => {
        const name = await getLineGroupName(token, group.groupId).catch(
          () => undefined,
        );
        return name ? { ...group, name } : null;
      }),
    );
    const names = summaries.filter((summary) => summary !== null);
    if (names.length > 0)
      await ctx.runMutation(updateGroupNames, {
        connectionId: connection._id,
        revision,
        names,
      });
    return null;
  },
});

export const deliverReply = internalAction({
  args: { questionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { questionId }) => {
    const claim = await ctx.runMutation(claimReply, { questionId });
    if (!claim) return null;
    const work = { questionId, leaseId: claim.leaseId };
    const token = await decryptLineCredential(
      claim.tokenCiphertext,
      "access-token",
      process.env.LINE_SECRETS_KEY,
    ).catch(() => null);
    const result = token
      ? await deliverLineReply(token, claim, () =>
          ctx.runQuery(authorizeReply, work).catch(() => false),
        )
      : null;
    const acceptedRequestId =
      result?.state === "accepted" ? result.acceptedRequestId : undefined;
    await ctx.runMutation(finishReply, {
      ...work,
      state: result?.state ?? "failed",
      ...(acceptedRequestId ? { acceptedRequestId } : {}),
    });
    return null;
  },
});
