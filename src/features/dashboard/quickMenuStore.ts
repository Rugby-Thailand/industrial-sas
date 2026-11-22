import {
  isQuickMenuKey,
  pinnedKeysProblem,
  QUICK_MENU_REQUEST_ID,
  MAX_QUICK_MENU_VERSION,
  type QuickMenuClerkScope,
  type QuickMenuKey,
  type QuickMenuSaveArgs,
} from "../../../convex/model/home/quickMenu";

export interface QuickMenuCommand extends QuickMenuSaveArgs {
  readonly pinnedKeys: readonly QuickMenuKey[];
}

export type QuickMenuRecoveryState =
  | { readonly status: "empty" }
  | { readonly status: "command"; readonly command: QuickMenuCommand }
  | { readonly status: "invalid"; readonly key: string }
  | { readonly status: "unavailable" };

const PREFIX = "yongkit.home.quickMenu.v1:";
const commandPrefix = (scope: QuickMenuClerkScope, actorUserId: string) =>
  `${PREFIX}${JSON.stringify([scope.clerkOrgId, scope.clerkUserId, actorUserId])}:`;

function commandKey(command: QuickMenuCommand) {
  return (
    commandPrefix(command.expectedClerkScope, command.expectedActorUserId) +
    command.requestId
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQuickMenuCommand(
  key: string,
  raw: string,
  scope: QuickMenuClerkScope,
  actorUserId: string,
): QuickMenuCommand | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const {
    requestId,
    expectedClerkScope,
    expectedActorUserId,
    expectedVersion,
    pinnedKeys,
  } = parsed;
  if (
    typeof requestId !== "string" ||
    !QUICK_MENU_REQUEST_ID.test(requestId) ||
    !isRecord(expectedClerkScope) ||
    typeof expectedClerkScope.clerkOrgId !== "string" ||
    typeof expectedClerkScope.clerkUserId !== "string" ||
    !sameClerkScope(
      {
        clerkOrgId: expectedClerkScope.clerkOrgId,
        clerkUserId: expectedClerkScope.clerkUserId,
      },
      scope,
    ) ||
    expectedActorUserId !== actorUserId ||
    typeof expectedVersion !== "number" ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    expectedVersion >= MAX_QUICK_MENU_VERSION ||
    !Array.isArray(pinnedKeys) ||
    !pinnedKeys.every(isQuickMenuKey) ||
    pinnedKeysProblem(pinnedKeys) !== null ||
    key !== commandPrefix(scope, actorUserId) + requestId
  )
    return null;
  return {
    requestId,
    expectedClerkScope: scope,
    expectedActorUserId: actorUserId,
    expectedVersion,
    pinnedKeys,
  };
}

export function sameClerkScope(
  left: QuickMenuClerkScope,
  right: QuickMenuClerkScope,
) {
  return (
    left.clerkOrgId === right.clerkOrgId &&
    left.clerkUserId === right.clerkUserId
  );
}

export function storeQuickMenuCommand(command: QuickMenuCommand) {
  localStorage.setItem(commandKey(command), JSON.stringify(command));
}

export function removeQuickMenuCommand(command: QuickMenuCommand) {
  localStorage.removeItem(commandKey(command));
}

/** Removes only the inspected key within the current identity if it is still invalid. */
export function removeInvalidQuickMenuCommand(
  scope: QuickMenuClerkScope,
  actorUserId: string,
  key: string,
) {
  const prefix = commandPrefix(scope, actorUserId);
  if (!key.startsWith(prefix)) return false;
  const raw = localStorage.getItem(key);
  if (raw === null) return false;
  if (parseQuickMenuCommand(key, raw, scope, actorUserId) !== null)
    return false;
  localStorage.removeItem(key);
  return true;
}

function scanQuickMenuCommand(
  scope: QuickMenuClerkScope,
  actorUserId: string,
): Exclude<QuickMenuRecoveryState, { readonly status: "unavailable" }> {
  const prefix = commandPrefix(scope, actorUserId);
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const command = parseQuickMenuCommand(key, raw, scope, actorUserId);
    if (command === null) return { status: "invalid", key };
    return { status: "command", command };
  }
  return { status: "empty" };
}

/** Distinguishes valid commands, malformed scoped entries, and unavailable storage. */
export function inspectQuickMenuCommand(
  scope: QuickMenuClerkScope,
  actorUserId: string,
): QuickMenuRecoveryState {
  try {
    return scanQuickMenuCommand(scope, actorUserId);
  } catch {
    return { status: "unavailable" };
  }
}

/** Commands own independent keys so two writers cannot erase each other's record. */
export function readQuickMenuCommand(
  scope: QuickMenuClerkScope,
  actorUserId: string,
) {
  const state = scanQuickMenuCommand(scope, actorUserId);
  if (state.status === "invalid") throw new Error("INVALID_RECOVERY");
  return state.status === "command" ? state.command : null;
}
