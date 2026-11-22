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

const PREFIX = "yongkit.home.quickMenu.v1:";
const commandPrefix = (scope: QuickMenuClerkScope, actorUserId: string) =>
  `${PREFIX}${JSON.stringify([scope.clerkOrgId, scope.clerkUserId, actorUserId])}:`;

function commandKey(command: QuickMenuCommand) {
  return (
    commandPrefix(command.expectedClerkScope, command.expectedActorUserId) +
    command.requestId
  );
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

/** Commands own independent keys so two writers cannot erase each other's record. */
export function readQuickMenuCommand(
  scope: QuickMenuClerkScope,
  actorUserId: string,
) {
  const prefix = commandPrefix(scope, actorUserId);
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const entry: Partial<QuickMenuCommand> = JSON.parse(raw);
    if (
      typeof entry.requestId !== "string" ||
      !QUICK_MENU_REQUEST_ID.test(entry.requestId) ||
      !entry.expectedClerkScope ||
      !sameClerkScope(entry.expectedClerkScope, scope) ||
      entry.expectedActorUserId !== actorUserId ||
      typeof entry.expectedVersion !== "number" ||
      !Number.isSafeInteger(entry.expectedVersion) ||
      entry.expectedVersion < 0 ||
      entry.expectedVersion >= MAX_QUICK_MENU_VERSION ||
      !Array.isArray(entry.pinnedKeys) ||
      !entry.pinnedKeys.every(isQuickMenuKey) ||
      !!pinnedKeysProblem(entry.pinnedKeys) ||
      key !== prefix + entry.requestId
    )
      throw new Error("INVALID_RECOVERY");
    return {
      requestId: entry.requestId,
      expectedClerkScope: scope,
      expectedActorUserId: actorUserId,
      expectedVersion: entry.expectedVersion,
      pinnedKeys: entry.pinnedKeys,
    } satisfies QuickMenuCommand;
  }
  return null;
}
