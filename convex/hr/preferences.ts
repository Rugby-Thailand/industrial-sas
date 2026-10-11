/** Authenticated member/org shortcut preferences for delivered employee pages. */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { fail, hrCommand, linkedEmployee } from "./shared";

export const SHORTCUT_KEYS = [
  "hr.today",
  "hr.time",
  "hr.requests",
  "hr.holidays",
  "hr.profile",
  "hr.leave",
  "hr.announcements",
  "hr.payslips",
  "hr.notifications",
] as const;

type ShortcutKey = (typeof SHORTCUT_KEYS)[number];
type Shortcut = { key: ShortcutKey; visible: boolean };
type Preferences = Doc<"hrShortcutPreferences">;

const defaults = (): Shortcut[] =>
  SHORTCUT_KEYS.map((key) => ({ key, visible: true }));

/** Extend old saved lists while retaining their order and hidden entries. */
function normalize(
  input: readonly { key: string; visible: boolean }[],
): Shortcut[] {
  const seen = new Set<string>();
  const kept: Shortcut[] = [];
  for (const item of input) {
    const key = SHORTCUT_KEYS.find((key) => key === item.key);
    if (key && !seen.has(key)) {
      kept.push({ key, visible: item.visible });
      seen.add(key);
    }
  }
  return [...kept, ...defaults().filter((item) => !seen.has(item.key))];
}

const preferenceOf = async (ctx: TenantFunctionContext) =>
  await ctx.tenantDb
    .byIndex<Preferences>("hrShortcutPreferences", "by_orgId_userId", [
      { field: "userId", value: ctx.tenant.actor._id },
    ])
    .unique();

/** Reject arbitrary routes, partial lists and duplicate keys before writing. */
function validShortcuts(
  input: readonly { key: string; visible: boolean }[],
): input is readonly Shortcut[] {
  return (
    input.length === SHORTCUT_KEYS.length &&
    new Set(input.map((shortcut) => shortcut.key)).size ===
      SHORTCUT_KEYS.length &&
    input.every((shortcut) => SHORTCUT_KEYS.some((key) => key === shortcut.key))
  );
}

export const current = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrShortcutPreferences" },
  handler: async (ctx) => {
    if ((await linkedEmployee(ctx)) === null)
      return { ok: false as const, code: "HR_NOT_LINKED" };
    const stored = await preferenceOf(ctx);
    return {
      ok: true as const,
      // The fixed allowlist contains only destinations granted by selfAccess.
      // Clock controls live on Today independently of shortcut visibility.
      shortcuts: stored ? normalize(stored.shortcuts) : defaults(),
      version: stored?.version ?? 0,
      ...(stored ? { updatedAt: stored.updatedAt } : {}),
    };
  },
});

export const save = mutationWithOrg({
  args: {
    requestId: v.string(),
    expectedVersion: v.number(),
    shortcuts: v.array(v.object({ key: v.string(), visible: v.boolean() })),
  },
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrShortcutPreferences" },
  handler: async (ctx, args) => {
    // Linking is checked on every attempt, including an idempotent replay.
    if ((await linkedEmployee(ctx)) === null) return fail("HR_NOT_LINKED");
    return await hrCommand(ctx, {
      operation: "hr.preferences.save",
      requestId: args.requestId,
      payload: {
        expectedVersion: args.expectedVersion,
        shortcuts: args.shortcuts,
      },
      table: "hrShortcutPreferences",
      replay: async (id) => {
        const stored = await ctx.tenantDb.get<Preferences>(
          "hrShortcutPreferences",
          id,
        );
        return stored?.userId === ctx.tenant.actor._id
          ? { version: stored.version, shortcuts: stored.shortcuts }
          : null;
      },
      run: async () => {
        if (!validShortcuts(args.shortcuts))
          return fail("PREFERENCES_INVALID", "shortcuts");
        if (
          !Number.isSafeInteger(args.expectedVersion) ||
          args.expectedVersion < 0
        )
          return fail("PREFERENCES_INVALID", "expectedVersion");
        const stored = await preferenceOf(ctx);
        if ((stored?.version ?? 0) !== args.expectedVersion)
          return fail("PREFERENCES_STALE", "expectedVersion");
        const now = Date.now();
        const version = args.expectedVersion + 1;
        const fields = {
          shortcuts: args.shortcuts,
          version,
          updatedAt: now,
        };
        let documentId: string;
        if (stored) {
          documentId = stored._id;
          await ctx.tenantDb.patch("hrShortcutPreferences", documentId, fields);
        } else {
          documentId = await ctx.tenantDb.insert("hrShortcutPreferences", {
            ...fields,
            userId: ctx.tenant.actor._id,
            createdAt: now,
          });
        }
        return {
          documentId,
          extra: { version, shortcuts: args.shortcuts },
          changes: [
            {
              field: "version",
              from: String(args.expectedVersion),
              to: String(version),
            },
            { field: "shortcuts", to: JSON.stringify(args.shortcuts) },
          ],
        };
      },
    });
  },
});
