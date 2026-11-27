import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { LIMITS } from "./policy";
import { isLineGroupId } from "./transportInput";

export const updateGroupNames = internalMutation({
  args: {
    connectionId: v.string(),
    revision: v.number(),
    names: v.array(
      v.object({
        groupId: v.string(),
        timestamp: v.number(),
        name: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, revision, names }) => {
    if (names.length > 5) return null;
    const id = ctx.db.normalizeId("customerLineConnections", connectionId);
    const connection = id === null ? null : await ctx.db.get(id);
    if (
      connection === null ||
      connection.state === "disconnected" ||
      connection.revision !== revision
    )
      return null;
    for (const { groupId, timestamp, name } of names) {
      const title = name
        .replace(/[\p{Cc}\p{Cf}]/gu, "")
        .trim()
        .slice(0, LIMITS.groupName);
      if (!isLineGroupId(groupId) || !title) continue;
      const group = await ctx.db
        .query("customerLineGroups")
        .withIndex("by_orgId_connectionId_lineGroupId", (q) =>
          q
            .eq("orgId", connection.orgId)
            .eq("connectionId", connection._id)
            .eq("lineGroupId", groupId),
        )
        .order("desc")
        .first();
      if (
        !group?.current ||
        group.leftAt !== undefined ||
        group.joinedAt !== timestamp
      )
        continue;
      await ctx.db.patch("customerLineGroups", group._id, { name: title });
    }
    return null;
  },
});
