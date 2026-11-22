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

import { QuickMenuCustomizeSheet } from "./QuickMenuCustomizeSheet";
import { quickMenuTile } from "./quickMenuCatalog";
import {
  readQuickMenuCommand,
  removeQuickMenuCommand,
  sameClerkScope,
  storeQuickMenuCommand,
  type QuickMenuCommand,
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

function equalKeys(left: readonly MenuKey[], right: readonly MenuKey[]) {
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index])
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
  const [unconfirmedRequest, setUnconfirmedRequest] = useState<string>();
  const [verifying, setVerifying] = useState(false);
  const [recovery, setRecovery] = useState<{
    readonly owner: string;
    readonly command: QuickMenuCommand | null;
    readonly unavailable?: boolean;
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
      setUnconfirmedRequest(undefined);
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
      try {
        setRecovery({
          owner: snapshotOwner,
          command: readQuickMenuCommand(
            snapshot.clerkScope,
            snapshot.actorUserId,
          ),
        });
      } catch {
        setRecovery({ owner: snapshotOwner, command: null, unavailable: true });
      }
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
  const command = recoveryReady ? recovery.command : null;
  const recoveryUnavailable = recoveryReady && !!recovery.unavailable;
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
    !!snapshot &&
    recoveryReady &&
    !command &&
    !recoveryUnavailable &&
    !stale &&
    !atLimit;
  const readFailed = current.status === "error";
  const retryRead = () => setReadRetryAttempt(nextReadAttempt());
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
    setUnconfirmedRequest(undefined);
  };

  function setSheetOpen(next: boolean) {
    if (next && !snapshot) return;
    if (next && snapshot && snapshotOwner) {
      setDraft({
        owner: snapshotOwner,
        baseVersion: snapshot.version,
        baseKeys: pinned,
        pinned,
      });
    } else discard();
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

  function refreshRecovery(owner: string, entry: QuickMenuCommand) {
    try {
      const pending = readQuickMenuCommand(
        entry.expectedClerkScope,
        entry.expectedActorUserId,
      );
      setRecovery((current) =>
        current?.owner === owner ? { owner, command: pending } : current,
      );
      return pending;
    } catch {
      setRecovery((current) =>
        current?.owner === owner
          ? { owner, command: null, unavailable: true }
          : current,
      );
      return undefined;
    }
  }

  async function issue(entry: QuickMenuCommand, retry: boolean) {
    try {
      const result = await saveMutation(entry);
      const outcome = result.ok ? result.value : null;
      if (outcome?.ok) {
        removeQuickMenuCommand(entry);
        return true;
      }
      // A refusal of a recovery attempt cannot settle the original attempt.
      if (!retry) removeQuickMenuCommand(entry);
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
    const next: QuickMenuCommand = {
      requestId: crypto.randomUUID(),
      expectedClerkScope: snapshot.clerkScope,
      expectedActorUserId: snapshot.actorUserId,
      expectedVersion: activeDraft.baseVersion,
      pinnedKeys: activeDraft.pinned,
    };
    setMessage("");
    setVerifying(false);
    return (
      (await op
        .run(
          async () => {
            // Recheck storage immediately before issuing a mutation. A tab may
            // have created a command since our last storage event.
            const pending = readQuickMenuCommand(
              snapshot.clerkScope,
              snapshot.actorUserId,
            );
            if (pending) {
              setRecovery({ owner: snapshotOwner, command: pending });
              throw new Error("RECOVERY_PENDING");
            }
            storeQuickMenuCommand(next);
            return issue(next, false);
          },
          closeAfterSave ? finish : discard,
        )
        .finally(() => refreshRecovery(snapshotOwner, next))) === true
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

  const canResend =
    !!snapshot &&
    !!command &&
    command.requestId === unconfirmedRequest &&
    snapshot.version === command.expectedVersion &&
    !atLimit &&
    command.pinnedKeys.every((key) => available.includes(key));

  // A save based on an older version can no longer commit. After checking its
  // receipt the member can release just this command and keep editing.
  const superseded =
    !!command &&
    command.requestId === unconfirmedRequest &&
    !!snapshot &&
    !atLimit &&
    snapshot.version > command.expectedVersion;
  function dismissSuperseded() {
    if (!superseded || !command || !snapshotOwner || op.busy) return;
    try {
      removeQuickMenuCommand(command);
      refreshRecovery(snapshotOwner, command);
      setMessage("");
      setUnconfirmedRequest(undefined);
    } catch {
      setMessage(t("checkError"));
    }
  }

  function resend() {
    if (!command || !snapshotOwner || !canResend) return;
    setMessage("");
    setUnconfirmedRequest(undefined);
    setVerifying(false);
    void op.run(
      () => issue(command, true),
      () => {
        if (refreshRecovery(snapshotOwner, command) === null)
          finishRecovered(command);
      },
    );
  }

  function verify() {
    if (!snapshot || !snapshotOwner || !command) return;
    setMessage("");
    setUnconfirmedRequest(undefined);
    setVerifying(true);
    void op.run(
      async () => {
        try {
          const result = await convex.query(receiptRef, command);
          if (!result.ok) throw new Error("RECEIPT_DENIED");
          if (result.value.status === "NOT_FOUND") return false;
          if (result.value.status !== "CONFIRMED")
            throw new Error(result.value.status);
          removeQuickMenuCommand(command);
          return true;
        } catch (error) {
          throw new Error("VERIFICATION_FAILED", { cause: error });
        }
      },
      (confirmed) => {
        if (!confirmed) {
          setMessage(t("unconfirmed"));
          setUnconfirmedRequest(command.requestId);
          return;
        }
        const next = refreshRecovery(snapshotOwner, command);
        retryRead();
        if (next === null) finishRecovered(command);
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
        : recoveryUnavailable
          ? t("checkError")
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
        verifying={verifying}
        save={canSave ? save : undefined}
        discard={discard}
        status={status}
        readRetry={
          readFailed || recoveryUnavailable || badgeStatus === "error"
            ? retryRead
            : undefined
        }
        verify={command ? verify : undefined}
        resend={canResend ? resend : undefined}
        dismissSuperseded={superseded ? dismissSuperseded : undefined}
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
