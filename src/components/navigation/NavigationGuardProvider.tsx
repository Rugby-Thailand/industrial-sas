"use client";

import { useLocale } from "next-intl";
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { LOCALES, type AppLocale } from "@/i18n/routing";
import {
  GUARD_HISTORY_KEY,
  subscribeHistoryWrites,
} from "@/lib/browser/appHistory";
import { browserQueryEvent } from "@/lib/browser/history";
import {
  announceNavigationIntent,
  registerNavigationGuardOwner,
  type Transition,
} from "@/lib/navigationGuard";

import {
  NavigationDraftContext,
  type DraftRegistration,
  type NavigationDraftOwner,
} from "./navigationDraft";

export {
  useNavigationDraft,
  type DraftRegistration,
  type NavigationDraftControl,
} from "./navigationDraft";

interface Summary {
  readonly pending: boolean;
  /** Exactly one dirty entry, and it can save. */
  readonly saveable: boolean;
  readonly saveBlockedReason?: string;
}

const EMPTY_SUMMARY: Summary = { pending: false, saveable: false };

function summarize(entries: ReadonlyMap<string, DraftRegistration>): Summary {
  const values = [...entries.values()];
  const dirty = values.filter((entry) => entry.dirty);
  const sole = dirty.length === 1 ? dirty[0] : undefined;
  return {
    pending: values.some((entry) => entry.pending),
    saveable: sole?.save !== undefined,
    ...(sole?.save !== undefined && sole.saveBlockedReason
      ? { saveBlockedReason: sole.saveBlockedReason }
      : {}),
  };
}

const sameSummary = (a: Summary, b: Summary) =>
  a.pending === b.pending &&
  a.saveable === b.saveable &&
  a.saveBlockedReason === b.saveBlockedReason;

const guarded = (entry: DraftRegistration) => entry.dirty || entry.pending;

/**
 * The shell's single owner of unsaved work. Every editor (storage
 * workspace, HR forms, job scan) registers an entry; this provider owns the
 * one same-URL history buffer, one set of browser listeners (link clicks,
 * Back/Forward, unload) and one prompt, and is the target of
 * `guardedNavigate`.
 *
 * Entries live in a ref (the synchronous source of truth) mirrored to state
 * only to render the prompt, so a completion that settles and navigates in
 * the same task sees its own change. No timers synchronize anything: every
 * continuation runs from the buffer's own popstate.
 */
export function NavigationGuardProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const locale = useLocale();
  const router = useRouter();
  const [prompt, setPrompt] = useState<{ action: Transition } | null>(null);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const [machine] = useState(() =>
    createGuardMachine({
      onSummary: (next) =>
        setSummary((current) => (sameSummary(current, next) ? current : next)),
      onPrompt: (action) => {
        setFailed(false);
        setPrompt({ action });
      },
    }),
  );

  useLayoutEffect(
    () => machine.setNavigate((href) => navigateToHref(router, href)),
    [machine, router],
  );
  useLayoutEffect(() => machine.connect(), [machine]);

  const owner = useMemo<NavigationDraftOwner>(
    () => ({
      update: machine.update,
      settle: machine.settle,
      requestTransition: machine.requestTransition,
    }),
    [machine],
  );

  const labels = guardLabels(locale === "th");
  const disabled = saving || summary.pending;
  const keepDisabled = saving;

  async function saveAndContinue() {
    if (!prompt || saving) return;
    const save = machine.soleSave();
    if (!save) return;
    setSaving(true);
    setFailed(false);
    try {
      if (!(await save())) {
        setFailed(true);
        return;
      }
      setPrompt(null);
      machine.proceed(prompt.action);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <NavigationDraftContext.Provider value={owner}>
      {children}
      <Dialog
        open={prompt !== null}
        onOpenChange={(open) => {
          if (!open && !keepDisabled) setPrompt(null);
        }}
      >
        <DialogContent
          closeLabel={labels.close}
          showCloseButton={!keepDisabled}
        >
          <DialogHeader>
            <DialogTitle>{labels.title}</DialogTitle>
            <DialogDescription>
              {summary.saveable ? labels.description : labels.descriptionNoSave}
            </DialogDescription>
          </DialogHeader>
          {summary.pending ? (
            <p
              role="status"
              className="text-sm text-warning"
              data-testid="navigation-guard-pending"
            >
              {labels.pending}
            </p>
          ) : null}
          {summary.saveBlockedReason ? (
            <p role="status" className="text-sm text-warning">
              {summary.saveBlockedReason}
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="text-sm text-danger">
              {labels.failed}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={keepDisabled}
              onClick={() => setPrompt(null)}
            >
              {labels.keep}
            </Button>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                if (!prompt || saving || !machine.discardAll()) return;
                setPrompt(null);
                machine.proceed(prompt.action);
              }}
            >
              {labels.discard}
            </Button>
            {summary.saveable ? (
              <Button
                disabled={disabled || Boolean(summary.saveBlockedReason)}
                onClick={() => void saveAndContinue()}
              >
                {saving ? labels.saving : labels.save}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NavigationDraftContext.Provider>
  );
}

/* History buffer state machine ------------------------------------------ */

/**
 * Buffer markers whose removal was still in flight when their owner
 * unmounted. A successor must not adopt them: the queued traversal would look
 * like a user's Back.
 */
const abandonedMarkers = new Set<string>();
let markerCounter = 0;
function newBufferMarker(): string {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${++markerCounter}`;
}

interface MachineDeps {
  readonly onSummary: (summary: Summary) => void;
  readonly onPrompt: (action: Transition) => void;
}

function createGuardMachine(deps: MachineDeps) {
  const entries = new Map<string, DraftRegistration>();
  /** Settled entries ignore stale dirty reports until they report clean. */
  const settled = new Set<string>();
  let bufferId: string | null = null;
  let bufferHref: string | null = null;
  let restoring = false;
  let removing = false;
  let removeRequested = false;
  let ownWrite = false;
  let afterRemove: Transition | undefined;
  let restoredLocation: { url: string; state: unknown } | null = null;
  let connected = false;
  let navigate: (href: URL) => void = () => undefined;

  const active = () => [...entries.values()].some(guarded);
  const onBuffer = () =>
    bufferId !== null && window.history.state?.[GUARD_HISTORY_KEY] === bufferId;
  // Our capture listener runs before bubble listeners at the window target,
  // so only the owner's own forward()/back() traversals need this signal.
  const traversing = () => restoring || removing;
  const refreshQueries = () =>
    window.dispatchEvent(new Event(browserQueryEvent));
  const publish = () => deps.onSummary(summarize(entries));

  function withOwnWrite(write: () => void) {
    ownWrite = true;
    try {
      write();
    } finally {
      ownWrite = false;
    }
  }

  function arm() {
    if (!connected || bufferId !== null || removing || !active()) return;
    // A same-URL buffer left by a previous owner or document (remount,
    // reload) already duplicates this page: reuse it rather than stacking a
    // second dead Back step.
    const existing: unknown = window.history.state?.[GUARD_HISTORY_KEY];
    if (typeof existing === "string" && !abandonedMarkers.has(existing)) {
      bufferId = existing;
      bufferHref = window.location.href;
      return;
    }
    const id = newBufferMarker();
    withOwnWrite(() =>
      window.history.pushState(
        { ...window.history.state, [GUARD_HISTORY_KEY]: id },
        "",
        window.location.href,
      ),
    );
    bufferId = id;
    bufferHref = window.location.href;
  }

  function finishRemoval(): Transition | undefined {
    removing = false;
    bufferId = null;
    bufferHref = null;
    restoredLocation = null;
    const action = afterRemove;
    afterRemove = undefined;
    return action;
  }

  /** Remove the buffer (if any), then run `action` from its popstate. */
  function removeBuffer(action?: Transition) {
    if (action) afterRemove = action;
    if (removing) return;
    if (restoring) {
      removeRequested = true;
      return;
    }
    if (!connected) {
      // The shell is unmounting (or StrictMode is re-running its effects):
      // keep the buffer for a reconnect and never traverse while detached.
      const next = afterRemove;
      afterRemove = undefined;
      next?.();
      return;
    }
    if (bufferId === null || !onBuffer()) {
      // Nothing to traverse: no buffer, or history already moved off it (a
      // route change unmounting the editor). Never step Back from a page the
      // buffer does not belong to.
      bufferId = null;
      bufferHref = null;
      const next = afterRemove;
      afterRemove = undefined;
      next?.();
      return;
    }
    const state = { ...window.history.state };
    delete state[GUARD_HISTORY_KEY];
    restoredLocation = { url: window.location.href, state };
    removing = true;
    window.history.back();
  }

  function proceed(action: Transition) {
    announceNavigationIntent();
    removeBuffer(action);
  }

  function requestTransition(action: Transition) {
    if (!active()) {
      proceed(action);
      return;
    }
    deps.onPrompt(action);
  }

  function sync() {
    publish();
    if (active()) arm();
    else if (bufferId !== null) removeBuffer();
  }

  function update(id: string, entry: DraftRegistration | null) {
    if (settled.has(id)) {
      if (entry !== null && guarded(entry)) return;
      settled.delete(id);
    }
    const before = entries.get(id);
    if (entry === null || !guarded(entry)) {
      if (before === undefined) return;
      entries.delete(id);
    } else {
      if (
        before !== undefined &&
        before.dirty === entry.dirty &&
        before.pending === entry.pending &&
        before.save === entry.save &&
        before.saveBlockedReason === entry.saveBlockedReason
      )
        return;
      entries.set(id, entry);
    }
    sync();
  }

  function settle(id: string, then?: Transition) {
    settled.add(id);
    entries.delete(id);
    publish();
    if (active()) {
      if (then) requestTransition(then);
      return;
    }
    if (then) proceed(then);
    else removeBuffer();
  }

  function discardAll(): boolean {
    const current = [...entries.values()];
    if (current.some((entry) => entry.pending)) return false;
    for (const entry of current) if (entry.dirty) entry.discard();
    return true;
  }

  function soleSave() {
    const values = [...entries.values()];
    const dirty = values.filter((entry) => entry.dirty);
    if (dirty.length !== 1 || values.some((entry) => entry.pending))
      return undefined;
    const [sole] = dirty;
    return sole?.saveBlockedReason ? undefined : sole?.save;
  }

  function onPopState(event: PopStateEvent) {
    if (removing) {
      // Consume only the buffer-removal traversal. The real transition
      // follows, with Next's original history state preserved.
      event.stopImmediatePropagation();
      const previous = restoredLocation;
      if (previous)
        withOwnWrite(() =>
          window.history.replaceState(previous.state, "", previous.url),
        );
      const action = finishRemoval();
      refreshQueries();
      action?.();
      // An edit can arrive while an ordinary save removes the buffer.
      if (!action) arm();
      return;
    }
    if (
      restoring &&
      (event.state?.[GUARD_HISTORY_KEY] === bufferId ||
        window.location.href === bufferHref)
    ) {
      event.stopImmediatePropagation();
      restoring = false;
      // The cancelled Back never reached query subscribers; refresh them.
      refreshQueries();
      if (removeRequested) {
        removeRequested = false;
        removeBuffer();
      }
      return;
    }
    if (bufferId === null || !active()) return;
    // Restore the same-route buffer without unmounting the editor.
    event.stopImmediatePropagation();
    restoring = true;
    window.history.forward();
    requestTransition(() => window.history.back());
  }

  /**
   * Another write moved history while the owner was traversing its buffer.
   * The queued traversal is no longer ours to recognise, so drop the stale
   * state rather than let it consume a later, real Back.
   */
  function onHistoryWrite() {
    if (ownWrite) return;
    if (removing || restoring) {
      restoring = false;
      removeRequested = false;
      const action = finishRemoval();
      refreshQueries();
      action?.();
      if (!action) arm();
      return;
    }
    // A write that bypassed the guard left the buffer behind; re-arm on the
    // next registration change instead of tracking an entry we left.
    if (bufferId !== null && !onBuffer()) {
      bufferId = null;
      bufferHref = null;
    }
  }

  function onClick(event: MouseEvent) {
    if (
      !active() ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor =
      event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (
      !(anchor instanceof HTMLAnchorElement) ||
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self")
    )
      return;
    const destination = new URL(anchor.href, window.location.href);
    if (
      destination.origin !== window.location.origin ||
      !["http:", "https:"].includes(destination.protocol)
    )
      return;
    // A same-entry refresh keeps the buffer: the history tracker preserves
    // its marker when Next replaces the entry.
    if (
      destination.pathname === window.location.pathname &&
      destination.search === window.location.search
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requestTransition(() => navigate(destination));
  }

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (!active()) return;
    event.preventDefault();
    event.returnValue = "";
  }

  function connect() {
    connected = true;
    const release = registerNavigationGuardOwner({
      requestTransition,
      isTraversing: traversing,
    });
    const unsubscribe = subscribeHistoryWrites(onHistoryWrite);
    window.addEventListener("popstate", onPopState, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    // Reconcile entries registered while detached (child effects run first).
    // An adopted buffer with nothing to guard is left in place rather than
    // traversed during mount; the next clean report or Back resolves it.
    publish();
    if (active()) arm();
    return () => {
      connected = false;
      // A traversal this owner queued can no longer be recognised: never let
      // a successor adopt the buffer it is leaving.
      if ((removing || restoring) && bufferId !== null)
        abandonedMarkers.add(bufferId);
      release();
      unsubscribe();
      window.removeEventListener("popstate", onPopState, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }

  return {
    connect,
    setNavigate: (next: (href: URL) => void) => {
      navigate = next;
    },
    update,
    settle,
    requestTransition,
    proceed,
    discardAll,
    soleSave,
  };
}

function navigateToHref(
  router: ReturnType<typeof useRouter>,
  destination: URL,
) {
  // next-intl's router adds the locale prefix itself, so strip it from the
  // intercepted absolute URL to avoid /en/en or /th/th.
  const destinationLocale = LOCALES.find(
    (candidate) =>
      destination.pathname === `/${candidate}` ||
      destination.pathname.startsWith(`/${candidate}/`),
  ) as AppLocale | undefined;
  const barePath = destinationLocale
    ? destination.pathname.slice(destinationLocale.length + 1) || "/"
    : destination.pathname;
  router.push(
    barePath + destination.search + destination.hash,
    destinationLocale === undefined ? undefined : { locale: destinationLocale },
  );
}

function guardLabels(thai: boolean) {
  return {
    title: thai
      ? "บันทึกการเปลี่ยนแปลงก่อนออก?"
      : "Save changes before leaving?",
    description: thai
      ? "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก เลือกบันทึก ละทิ้ง หรือแก้ไขต่อ"
      : "You have unsaved changes. Save them, discard them, or keep editing.",
    descriptionNoSave: thai
      ? "มีข้อมูลที่กรอกไว้แต่ยังไม่ได้ส่ง เลือกละทิ้งเพื่อไปต่อ หรือกลับไปแก้ไขต่อ"
      : "You have entered details that were not sent. Discard them to continue, or keep editing.",
    save: thai ? "บันทึกและดำเนินการต่อ" : "Save and continue",
    discard: thai ? "ละทิ้งการเปลี่ยนแปลง" : "Discard changes",
    keep: thai ? "แก้ไขต่อ" : "Keep editing",
    close: thai ? "ปิดหน้าต่าง" : "Close dialog",
    saving: thai ? "กำลังบันทึก…" : "Saving…",
    failed: thai
      ? "ยังบันทึกไม่ได้ การเปลี่ยนแปลงของคุณยังอยู่ กรุณาตรวจสอบแล้วลองอีกครั้ง"
      : "Could not save. Your changes are still here. Review them and try again.",
    pending: thai
      ? "กำลังส่งข้อมูลอยู่ รอให้เสร็จก่อนออกจากหน้านี้ หรือเลือกแก้ไขต่อ"
      : "A change is still being sent. Wait for it to finish before leaving, or keep editing.",
  };
}
