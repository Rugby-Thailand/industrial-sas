"use client";

import { useAuth } from "@clerk/nextjs";
import {
  useConvex,
  useConvexAuth,
  useMutation,
  useQuery_experimental,
} from "convex/react";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useOpenAllMenus } from "@/components/shell/useOpenAllMenus";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  type SheetCompletionHandle,
} from "@/components/ui/sheet";
import {
  operationErrorCode,
  useAsyncOperation,
} from "@/hooks/useAsyncOperation";
import { Link } from "@/i18n/navigation";

import { clientRef, type RefValue } from "@/lib/convex/clientRef";
import { api } from "../../../convex/_generated/api";
import {
  badgeCount,
  MAX_READ_RETRY_ATTEMPT,
  unreadBadgeText,
  type QuickMenuKey as MenuKey,
} from "../../../convex/model/home/quickMenu";

import {
  QuickMenuCustomizeSheet,
  type QuickMenuEditorProps,
} from "./QuickMenuCustomizeSheet";
import { quickMenuTile } from "./quickMenuCatalog";
import {
  inspectQuickMenuCommand,
  removeInvalidQuickMenuCommand,
  removeQuickMenuCommand,
  sameClerkScope,
  storeQuickMenuCommand,
  type QuickMenuCommand,
  type QuickMenuRecoveryState,
} from "./quickMenuStore";

const currentRef = clientRef(api.workspace.quickMenus.current);
const saveRef = clientRef(api.workspace.quickMenus.save);
const receiptRef = clientRef(api.workspace.quickMenus.receiptStatus);
const unreadRef = clientRef(api.hr.notifications.unreadSummary);
type Snapshot = RefValue<typeof currentRef>;
type Draft = {
  readonly owner: string;
  readonly baseVersion: number;
  readonly baseKeys: readonly MenuKey[];
  readonly pinned: readonly MenuKey[];
};

const EMPTY_KEYS: readonly MenuKey[] = [];
let lastReadAttempt = -1;
function nextReadAttempt() {
  lastReadAttempt = (lastReadAttempt + 1) % (MAX_READ_RETRY_ATTEMPT + 1);
  return lastReadAttempt;
}
const DEFINITIVE_ROLLBACK_CODES = new Set([
  "INVALID_INPUT",
  "INVALID_WRITE",
  "NOT_FOUND",
  "INVALID_INDEX_RESULT",
  "INVALID_INDEX_QUERY",
  "INVALID_TENANT_TABLE",
  "INVALID_LIMIT",
  "CAPACITY_DATA_LIMIT",
  "TENANT_SCOPE_MISMATCH",
  "ACTOR_SCOPE_MISMATCH",
]);

const DETERMINISTIC_RESEND_REFUSALS = new Set([
  "REQUEST_ID_INVALID",
  "PINNED_KEYS_INVALID",
  "VERSION_INVALID",
  "VERSION_LIMIT",
  "VERSION_STALE",
  "PIN_NOT_AVAILABLE",
  "REQUEST_ARGUMENT_CONFLICT",
]);

function equalKeys(left: readonly MenuKey[], right: readonly MenuKey[]) {
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index])
  );
}

function sameCommand(left: QuickMenuCommand, right: QuickMenuCommand) {
  return (
    left.requestId === right.requestId &&
    sameClerkScope(left.expectedClerkScope, right.expectedClerkScope) &&
    left.expectedActorUserId === right.expectedActorUserId &&
    left.expectedVersion === right.expectedVersion &&
    equalKeys(left.pinnedKeys, right.pinnedKeys)
  );
}

export function DashboardLiveContent() {
  const t = useTranslations("Home");
  const labels = useTranslations("Navigation");
  const { isLoaded, userId, orgId } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const convex = useConvex();
  const saveMutation = useMutation(saveRef);
  const openAllMenus = useOpenAllMenus();
  const sheetCompletion = useRef<SheetCompletionHandle>(null);
  const activeClerk = useMemo(
    () =>
      isLoaded && userId && orgId
        ? { clerkUserId: userId, clerkOrgId: orgId }
        : null,
    [isLoaded, userId, orgId],
  );
  const [readRetryAttempt, setReadRetryAttempt] = useState(nextReadAttempt);
  const current = useQuery_experimental({
    query: currentRef,
    args:
      activeClerk && isAuthenticated && !isLoading
        ? { expectedClerkScope: activeClerk, readRetryAttempt }
        : "skip",
  });
  const snapshot =
    current.status === "success" &&
    current.data.ok &&
    activeClerk &&
    isAuthenticated &&
    !isLoading &&
    sameClerkScope(current.data.value.clerkScope, activeClerk)
      ? current.data.value
      : null;
  const unread = useQuery_experimental({
    query: unreadRef,
    args:
      snapshot && snapshot.availableKeys.includes("hr.notifications")
        ? { expectedClerkScope: snapshot.clerkScope, readRetryAttempt }
        : "skip",
  });
  const unreadSummary =
    unread.status === "success" &&
    unread.data.ok &&
    snapshot &&
    sameClerkScope(unread.data.value.clerkScope, snapshot.clerkScope)
      ? unread.data.value
      : null;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [revocationEpoch, setRevocationEpoch] = useState(0);
  const [message, setMessage] = useState("");
  const [checkedReceipt, setCheckedReceipt] = useState<{
    readonly command: QuickMenuCommand;
    readonly status: "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT";
  }>();
  const [operation, setOperation] =
    useState<QuickMenuEditorProps["operation"]>("save");
  const [recovery, setRecovery] = useState<{
    readonly owner: string;
    readonly state: QuickMenuRecoveryState;
  } | null>(null);
  const snapshotOwner = snapshot
    ? JSON.stringify([
        snapshot.clerkScope.clerkOrgId,
        snapshot.clerkScope.clerkUserId,
        snapshot.actorUserId,
      ])
    : undefined;
  const [visit, setVisit] = useState<{
    owner: string;
    clerk: NonNullable<typeof activeClerk>;
  }>();
  const previous = useRef<{
    scope: typeof activeClerk;
    snapshot: Snapshot | null;
  }>({
    scope: null,
    snapshot: null,
  });
  const denied =
    isLoaded &&
    !isLoading &&
    (!activeClerk ||
      !isAuthenticated ||
      (current.status === "success" && !current.data.ok));
  useLayoutEffect(() => {
    const prior = previous.current;
    const changedClerk =
      !!prior.scope &&
      (!activeClerk || !sameClerkScope(prior.scope, activeClerk));
    const revoked =
      !!prior.snapshot &&
      (denied ||
        changedClerk ||
        (snapshot !== null &&
          (prior.snapshot.actorUserId !== snapshot.actorUserId ||
            prior.snapshot.availableKeys.some(
              (key) => !snapshot.availableKeys.includes(key),
            ))));
    if (revoked || changedClerk) {
      setOpen(false);
      setDraft(null);
      setMessage("");
      setCheckedReceipt(undefined);
      setRevocationEpoch((epoch) => epoch + 1);
      if (
        changedClerk ||
        (snapshot && prior.snapshot?.actorUserId !== snapshot.actorUserId)
      ) {
        setReadRetryAttempt(nextReadAttempt());
      }
    }
    if (snapshotOwner && activeClerk) {
      // Keep the committed actor through transport retries without reusing a prior Clerk identity.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisit((priorVisit) =>
        priorVisit?.owner === snapshotOwner
          ? priorVisit
          : { owner: snapshotOwner, clerk: activeClerk },
      );
    }
    if (revoked || changedClerk || snapshot) {
      previous.current = { scope: activeClerk, snapshot };
    } else if (!prior.scope) {
      previous.current = { scope: activeClerk, snapshot: null };
    }
  }, [activeClerk, denied, snapshot, snapshotOwner]);
  const operationOwner =
    snapshotOwner ??
    (activeClerk && !denied && visit && sameClerkScope(activeClerk, visit.clerk)
      ? visit.owner
      : undefined);
  const op = useAsyncOperation({
    scope:
      operationOwner === undefined
        ? undefined
        : `${operationOwner}:${revocationEpoch}`,
    navigation: "owned",
    describeError: () => t("saveError"),
  });

  useEffect(() => {
    if (snapshotOwner === undefined || snapshot === null) return;
    const sync = () => {
      setRecovery({
        owner: snapshotOwner,
        state: inspectQuickMenuCommand(
          snapshot.clerkScope,
          snapshot.actorUserId,
        ),
      });
    };
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [snapshotOwner, snapshot]);

  useEffect(() => {
    let connected = convex.connectionState().isWebSocketConnected;
    return convex.subscribeToConnectionState(({ isWebSocketConnected }) => {
      if (!connected && isWebSocketConnected)
        setReadRetryAttempt(nextReadAttempt());
      connected = isWebSocketConnected;
    });
  }, [convex]);

  const recoveryReady = !!snapshotOwner && recovery?.owner === snapshotOwner;
  const recoveryState = recoveryReady ? recovery.state : null;
  const command =
    recoveryState?.status === "command" ? recoveryState.command : null;
  const recoveryInvalid = recoveryState?.status === "invalid";
  const recoveryUnavailable = recoveryState?.status === "unavailable";
  const activeDraft = draft?.owner === operationOwner ? draft : null;
  const available = snapshot?.availableKeys ?? EMPTY_KEYS;
  const pinned = (snapshot?.pinnedKeys ?? EMPTY_KEYS).filter((key) =>
    available.includes(key),
  );
  const draftPinned = activeDraft?.pinned ?? pinned;
  const dirty =
    !!activeDraft && !equalKeys(activeDraft.pinned, activeDraft.baseKeys);
  const stale =
    !!activeDraft && !!snapshot && snapshot.version !== activeDraft.baseVersion;
  const atLimit = !!snapshot && snapshot.version >= snapshot.maxVersion;
  const canSave =
    !!snapshot && recoveryState?.status === "empty" && !stale && !atLimit;
  const readFailed = current.status === "error";
  const retryRead = () => {
    if (recoveryUnavailable) {
      setMessage("");
      op.setError("");
    }
    setReadRetryAttempt(nextReadAttempt());
    if (snapshot && snapshotOwner) {
      refreshRecovery(snapshotOwner, snapshot.clerkScope, snapshot.actorUserId);
    }
  };
  const badgeStatus =
    pinned.some((key) => quickMenuTile(key).badge !== undefined) &&
    !unreadSummary
      ? unread.status === "pending"
        ? "pending"
        : "error"
      : null;

  const discard = () => {
    setDraft(null);
    setMessage("");
    setCheckedReceipt(undefined);
  };

  function loadSavedDraft() {
    if (!snapshot || !snapshotOwner) return;
    setDraft({
      owner: snapshotOwner,
      baseVersion: snapshot.version,
      baseKeys: pinned,
      pinned,
    });
  }

  function setSheetOpen(next: boolean) {
    if (next && !snapshot) return;
    if (next) loadSavedDraft();
    else discard();
    setOpen(next);
  }

  function finish() {
    setDraft(null);
    setMessage("");
    op.complete(() => {
      if (!sheetCompletion.current?.completeOwned?.(() => setOpen(false))) {
        // A newer foreground may own the current entry. Retire only this editor.
        setRevocationEpoch((epoch) => epoch + 1);
        setOpen(false);
      }
    });
  }

  function refreshRecovery(
    owner: string,
    scope: QuickMenuCommand["expectedClerkScope"],
    actorUserId: string,
  ) {
    const state = inspectQuickMenuCommand(scope, actorUserId);
    setRecovery((current) =>
      current?.owner === owner ? { owner, state } : current,
    );
    return state;
  }

  async function issue(entry: QuickMenuCommand, retry: boolean) {
    try {
      const result = await saveMutation(entry);
      const outcome = result.ok ? result.value : null;
      if (outcome?.ok) {
        removeQuickMenuCommand(entry);
        return true;
      }
      // Initial refusals never wrote; post-receipt resend refusals only release
      // when the server proves this exact payload cannot commit.
      if (
        !retry ||
        (outcome !== null && DETERMINISTIC_RESEND_REFUSALS.has(outcome.code))
      ) {
        removeQuickMenuCommand(entry);
      }
      throw new Error(outcome?.code ?? "ACCESS_DENIED");
    } catch (error) {
      if (!retry && DEFINITIVE_ROLLBACK_CODES.has(operationErrorCode(error))) {
        removeQuickMenuCommand(entry);
      }
      throw error;
    }
  }

  async function save(closeAfterSave = false) {
    if (!snapshot || !snapshotOwner || !activeDraft || !canSave || !dirty)
      return false;
    const owner = snapshotOwner;
    const next: QuickMenuCommand = {
      requestId: crypto.randomUUID(),
      expectedClerkScope: snapshot.clerkScope,
      expectedActorUserId: snapshot.actorUserId,
      expectedVersion: activeDraft.baseVersion,
      pinnedKeys: activeDraft.pinned,
    };
    setMessage("");
    setOperation("save");
    return (
      (await op
        .run(
          async () => {
            // Recheck storage immediately before issuing a mutation. A tab may
            // have created or damaged a record since our last storage event.
            const pending = inspectQuickMenuCommand(
              next.expectedClerkScope,
              next.expectedActorUserId,
            );
            if (pending.status !== "empty") {
              setRecovery({ owner, state: pending });
              throw new Error(
                pending.status === "command"
                  ? "RECOVERY_PENDING"
                  : pending.status === "invalid"
                    ? "INVALID_RECOVERY"
                    : "STORAGE_UNAVAILABLE",
              );
            }
            storeQuickMenuCommand(next);
            return issue(next, false);
          },
          closeAfterSave ? finish : discard,
        )
        .finally(() =>
          refreshRecovery(
            owner,
            next.expectedClerkScope,
            next.expectedActorUserId,
          ),
        )) === true
    );
  }

  function finishRecovered(entry: QuickMenuCommand) {
    if (
      !dirty ||
      (activeDraft?.baseVersion === entry.expectedVersion &&
        equalKeys(activeDraft.pinned, entry.pinnedKeys))
    )
      finish();
  }

  const receiptForCommand =
    command && checkedReceipt && sameCommand(checkedReceipt.command, command)
      ? checkedReceipt.status
      : null;

  const canResend =
    !!snapshot &&
    !!command &&
    receiptForCommand === "NOT_FOUND" &&
    snapshot.version === command.expectedVersion &&
    !atLimit &&
    command.pinnedKeys.every((key) => available.includes(key));

  // After a legitimate scoped receipt check proves this payload cannot be
  // replayed (CONFLICT/INVALID_INPUT, or NOT_FOUND blocked by version, limit,
  // or lost grants), the member can explicitly release just this command.
  const canDismissUnavailable =
    !!snapshot &&
    !!command &&
    (receiptForCommand === "CONFLICT" ||
      receiptForCommand === "INVALID_INPUT" ||
      (receiptForCommand === "NOT_FOUND" && !canResend));

  function dismissUnavailable() {
    if (!canDismissUnavailable || !command || !snapshotOwner || op.busy) return;
    const target = command;
    const owner = snapshotOwner;
    try {
      removeQuickMenuCommand(target);
      loadSavedDraft();
      setMessage("");
      op.setError("");
      setCheckedReceipt(undefined);
      refreshRecovery(
        owner,
        target.expectedClerkScope,
        target.expectedActorUserId,
      );
    } catch {
      refreshRecovery(
        owner,
        target.expectedClerkScope,
        target.expectedActorUserId,
      );
      setMessage(t("checkError"));
    }
  }

  function resetInvalid() {
    if (
      !snapshot ||
      !snapshotOwner ||
      op.busy ||
      recoveryState?.status !== "invalid"
    )
      return;
    const owner = snapshotOwner;
    const invalidKey = recoveryState.key;
    try {
      removeInvalidQuickMenuCommand(
        snapshot.clerkScope,
        snapshot.actorUserId,
        invalidKey,
      );
      setMessage("");
      op.setError("");
      setCheckedReceipt(undefined);
      refreshRecovery(owner, snapshot.clerkScope, snapshot.actorUserId);
    } catch {
      setRecovery({ owner, state: { status: "unavailable" } });
      setMessage(t("checkError"));
    }
  }

  function resend() {
    if (!command || !snapshotOwner || !canResend) return;
    const target = command;
    const owner = snapshotOwner;
    setMessage("");
    setCheckedReceipt(undefined);
    setOperation("resend");
    void op
      .run(
        () => issue(target, true),
        () => {
          const next = refreshRecovery(
            owner,
            target.expectedClerkScope,
            target.expectedActorUserId,
          );
          if (next.status === "empty") finishRecovered(target);
        },
      )
      .finally(() =>
        refreshRecovery(
          owner,
          target.expectedClerkScope,
          target.expectedActorUserId,
        ),
      );
  }

  function verify() {
    if (!snapshot || !snapshotOwner || !command) return;
    const target = command;
    const owner = snapshotOwner;
    setMessage("");
    setCheckedReceipt(undefined);
    setOperation("verify");
    void op.run(
      async () => {
        try {
          const result = await convex.query(receiptRef, target);
          if (!result.ok) throw new Error("RECEIPT_DENIED");
          const receipt = result.value?.status;
          if (
            receipt === "NOT_FOUND" ||
            receipt === "CONFLICT" ||
            receipt === "INVALID_INPUT"
          ) {
            return receipt;
          }
          if (receipt !== "CONFIRMED") throw new Error(String(receipt));
          removeQuickMenuCommand(target);
          return "CONFIRMED" as const;
        } catch (error) {
          throw new Error("VERIFICATION_FAILED", { cause: error });
        }
      },
      (receipt) => {
        if (receipt === "NOT_FOUND") {
          setMessage(t("unconfirmed"));
          setCheckedReceipt({ command: target, status: "NOT_FOUND" });
          return;
        }
        if (receipt === "CONFLICT" || receipt === "INVALID_INPUT") {
          setMessage(t("receiptCannotReplay"));
          setCheckedReceipt({ command: target, status: receipt });
          return;
        }
        const next = refreshRecovery(
          owner,
          target.expectedClerkScope,
          target.expectedActorUserId,
        );
        retryRead();
        if (next.status === "empty") finishRecovered(target);
      },
    );
  }

  const status =
    message ||
    (readFailed
      ? t("readError")
      : command
        ? op.errorCode === "VERIFICATION_FAILED"
          ? t("checkError")
          : t("recovery")
        : recoveryInvalid
          ? t("invalidRecovery")
          : recoveryUnavailable
            ? t("storageUnavailable")
            : atLimit
              ? t("versionLimit")
              : stale
                ? t("stale")
                : snapshot
                  ? op.error ||
                    (badgeStatus === "error" ? t("badgesUnavailable") : "")
                  : t("loading"));

  return (
    <Sheet
      open={open}
      onOpenChange={setSheetOpen}
      backPending={op.busy}
      backRevocationEpoch={revocationEpoch}
      completionRef={sheetCompletion}
    >
      <section aria-labelledby="quick-menu-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="quick-menu-heading"
            className="text-lg font-semibold text-text"
          >
            {t("quickMenus")}
          </h2>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="text-link"
              disabled={!snapshot}
            >
              <SlidersHorizontal aria-hidden />
              {t("customize")}
            </Button>
          </SheetTrigger>
        </div>
        <QuickMenuOverview
          denied={denied}
          readFailed={readFailed}
          loading={!snapshot}
          onRetry={retryRead}
          pinned={pinned}
          count={(key) =>
            unreadSummary
              ? (badgeCount(quickMenuTile(key).badge, unreadSummary) ?? 0)
              : 0
          }
          label={(key) => labels(quickMenuTile(key).labelKey)}
        />
        <UnreadBadgeStatus state={badgeStatus} onRetry={retryRead} />
        <Button
          type="button"
          variant="outline"
          className="relative w-full"
          onClick={openAllMenus}
        >
          {t("allMenus")}
          <ChevronRight aria-hidden className="absolute end-3 size-4" />
        </Button>
      </section>
      <QuickMenuCustomizeSheet
        pinned={draftPinned}
        available={available}
        onChange={(next) =>
          setDraft((current) => current && { ...current, pinned: next })
        }
        canEdit={canSave && !op.busy}
        dirty={dirty}
        pending={op.busy}
        operation={operation}
        save={canSave ? save : undefined}
        discard={discard}
        status={status}
        readRetry={
          readFailed || recoveryUnavailable || badgeStatus === "error"
            ? retryRead
            : undefined
        }
        verify={command ? verify : undefined}
        resend={
          canResend || (op.busy && operation === "resend") ? resend : undefined
        }
        dismissUnavailable={
          canDismissUnavailable ? dismissUnavailable : undefined
        }
        resetInvalid={recoveryInvalid ? resetInvalid : undefined}
      />
    </Sheet>
  );
}

function UnreadBadgeStatus({
  state,
  onRetry,
}: {
  readonly state: "pending" | "error" | null;
  readonly onRetry: () => void;
}) {
  const t = useTranslations("Home");
  if (state === null) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-muted">
      <p role="status">
        {t(state === "error" ? "badgesUnavailable" : "badgesLoading")}
      </p>
      {state === "error" && (
        <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
          {t("retryBadges")}
        </Button>
      )}
    </div>
  );
}

function QuickMenuOverview({
  denied,
  readFailed,
  loading,
  onRetry,
  pinned,
  count,
  label,
}: {
  readonly denied: boolean;
  readonly readFailed: boolean;
  readonly loading: boolean;
  readonly onRetry: () => void;
  readonly pinned: readonly MenuKey[];
  readonly count: (key: MenuKey) => number;
  readonly label: (key: MenuKey) => string;
}) {
  const t = useTranslations("Home");
  if (denied) return <Notice title={t("denied")} />;
  if (readFailed)
    return (
      <Notice tone="warning" title={t("readError")}>
        <Button type="button" variant="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      </Notice>
    );
  if (loading)
    return (
      <div role="status" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <span className="sr-only">{t("loading")}</span>
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            aria-hidden
            className="min-h-22 rounded-xl border border-border bg-surface motion-safe:animate-pulse"
          />
        ))}
      </div>
    );
  if (pinned.length === 0)
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted">
        {t("empty")}
      </p>
    );
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {pinned.map((key) => {
        const { href, Icon } = quickMenuTile(key);
        const title = label(key);
        const unread = count(key);
        const pill = unreadBadgeText(unread);
        return (
          <li key={key} className="min-w-0">
            <Link
              href={href}
              aria-label={
                pill
                  ? [
                      title,
                      pill === "99+"
                        ? t("unreadOverflow")
                        : t("unread", { count: unread }),
                    ].join(", ")
                  : undefined
              }
              data-unread={pill ? "" : undefined}
              className="relative flex h-full min-h-22 min-w-0 flex-col items-start justify-center gap-1.5 rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-sm font-semibold text-text focus-ring transition-colors hover:border-link hover:bg-raised sm:flex-row sm:items-center sm:justify-start sm:gap-3 sm:px-4 sm:data-unread:pe-12"
            >
              <Icon aria-hidden className="size-6 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
              {pill && (
                <span
                  aria-hidden
                  className="absolute end-2 top-2 min-w-6 rounded-full bg-primary px-1.5 py-0.5 text-center text-xs font-semibold text-primary-foreground tabular-nums"
                >
                  {pill}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
