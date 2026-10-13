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
  appHistoryIndex,
  GUARD_HISTORY_KEY,
  subscribeHistoryWrites,
} from "@/lib/browser/appHistory";
import { browserQueryEvent } from "@/lib/browser/history";
import {
  announceNavigationIntent,
  backWithinPage,
  hasBackWithinPage,
  type TransitionOptions,
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
 * Back/Forward, and unload while work is guarded) and one prompt, and is the
 * target of `guardedNavigate`.
 *
 * Entries live in a ref (the synchronous source of truth) mirrored to state
 * only to render the prompt, so a completion that settles and navigates in
 * the same task sees its own change. No timers synchronize anything: every
 * continuation runs from the buffer's own popstate.
 *
 * The owner also holds the prompt's requested action and decides every
 * continuation. A decision covers the registrations as they were reported
 * when it was made (a successful save covers only its own draft); work
 * reported after that is checked again before the action runs and, if
 * present, needs a fresh decision. Teardown, a newer request or a
 * superseding history write invalidates an approval.
 */
export function NavigationGuardProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const locale = useLocale();
  const router = useRouter();
  // Presentation only: the machine holds the requested action and decides.
  const [prompt, setPrompt] = useState(false);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const [machine] = useState(() =>
    createGuardMachine({
      onSummary: (next) =>
        setSummary((current) => (sameSummary(current, next) ? current : next)),
      onPrompt: (open) => {
        setFailed(false);
        setPrompt(open);
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
    if (saving) return;
    const attempt = machine.beginSave();
    if (!attempt) return;
    setSaving(true);
    setFailed(false);
    let saved = false;
    try {
      saved = await attempt.save();
    } catch {
      saved = false;
    }
    setSaving(false);
    // The owner decides from its current registrations and intent.
    if (machine.finishSave(attempt, saved)) setFailed(true);
  }

  return (
    <NavigationDraftContext.Provider value={owner}>
      {children}
      <Dialog
        managedBack={false}
        open={prompt}
        onOpenChange={(open) => {
          if (!open && !keepDisabled) machine.keep();
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
              onClick={() => machine.keep()}
            >
              {labels.keep}
            </Button>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => machine.discard()}
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
 * The same document route. Query-only replacements (e.g. a presentation
 * panel) may change the buffer entry's search after it duplicated its base;
 * the base keeps the route and the committed depth that identify it.
 */
function samePage(a: string, b: string): boolean {
  const left = new URL(a);
  const right = new URL(b);
  return left.origin === right.origin && left.pathname === right.pathname;
}

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
  readonly onPrompt: (open: boolean) => void;
}

/** The action the open prompt would continue. Identity marks one request. */
interface Intent {
  readonly action: Transition;
  readonly options?: TransitionOptions | undefined;
}

/** One Save and continue: its prompt intent and the registration it saves. */
interface SaveAttempt {
  readonly intent: Intent;
  readonly id: string;
  readonly save: () => Promise<boolean>;
  /** The registration reported clean after the attempt began. */
  cleared: boolean;
  /** It then gained work the attempt did not save (see `update`). */
  renewed: boolean;
}

/**
 * A permitted action and the registrations its decision covered (exactly as
 * they were reported). Anything else guarded when it runs is newer work.
 */
interface Approval {
  readonly action: Transition;
  readonly covered: ReadonlyMap<string, DraftRegistration>;
}

const NOTHING_COVERED: ReadonlyMap<string, DraftRegistration> = new Map();

/** The same-URL history entry this owner pushed or adopted for its page. */
interface OwnedBuffer {
  readonly marker: string;
  readonly href: string;
  /** The guarded page's committed app depth (its buffer adds none). */
  readonly index: number | undefined;
}

function createGuardMachine(deps: MachineDeps) {
  const entries = new Map<string, DraftRegistration>();
  /** Settled entries ignore stale dirty reports until they report clean. */
  const settled = new Set<string>();
  /** The open prompt's request; only the owner may continue it. */
  let intent: Intent | null = null;
  let attempt: SaveAttempt | null = null;
  let buffer: OwnedBuffer | null = null;
  let restoring = false;
  let rearmAfterTraversal = false;
  let afterRestore: (() => void) | undefined;
  /** Bounded re-aims when a restoration lands beside the buffer. */
  let restoreCorrections = 0;
  let removing = false;
  let removeRequested = false;
  let ownWrite = false;
  let afterRemove: Approval | undefined;
  let restoredLocation: { url: string; state: unknown } | null = null;
  let connected = false;
  /** `beforeunload` is attached only while connected with guarded work. */
  let unloadAttached = false;
  /**
   * A same-URL guard entry nobody owns: left by a previous document (a clean
   * reload dropped its unsaved state) or by a finished buffer. It is never
   * traversed on mount; a Back from it skips its duplicate base entry.
   */
  let orphan: { marker: string; href: string; index: number } | null = null;
  /**
   * The buffer a queued removal was leaving when a same-page push overtook
   * it and a fresh buffer was armed above. That removal's Back still lands
   * on this entry's unmarked base. Chromium then reports the history list
   * as it was when the Back was queued and silently drops any re-aim beyond
   * it, so restoration first steps onto this buffer, which sits directly
   * above its base. Cleared by the next traversal or a write that leaves
   * the fresh buffer.
   */
  let overtaken: { marker: string; href: string; index: number } | null = null;
  let executingApproval: Approval | undefined;
  let navigate: (href: URL) => void = () => undefined;

  const retained = (entry: DraftRegistration, scope: string) =>
    scope.startsWith("foreground:")
      ? entry.foregroundScope !== scope.slice("foreground:".length)
      : entry.workflowScope === scope;
  const selectedEntries = (options?: TransitionOptions) =>
    new Map(
      [...entries].filter(
        ([, entry]) =>
          entry.pending ||
          !options?.preserveDraftScope ||
          !retained(entry, options.preserveDraftScope),
      ),
    );
  const active = () => [...entries.values()].some(guarded);
  const onBuffer = () =>
    buffer !== null &&
    window.history.state?.[GUARD_HISTORY_KEY] === buffer.marker;
  /** Remember the current entry if it is an unowned, inactive guard entry. */
  function noteOrphan() {
    const marker: unknown = window.history.state?.[GUARD_HISTORY_KEY];
    const index = appHistoryIndex();
    orphan =
      buffer === null &&
      typeof marker === "string" &&
      !abandonedMarkers.has(marker) &&
      index !== undefined
        ? { marker, href: window.location.href, index }
        : null;
  }
  // Signals owner-controlled restoration/removal to committed URL readers.
  // Capture alone does not guarantee precedence over an earlier Window
  // listener in Chromium; it cannot guarantee isolation of every traversal.
  const traversing = () => restoring || removing;
  const refreshQueries = () =>
    window.dispatchEvent(new Event(browserQueryEvent));
  /**
   * Attach the owner's unload protection only while it can matter. A clean
   * owner adds no `beforeunload` listener that could block Firefox's
   * Back/Forward cache; other integrations may still have their own.
   * Runs synchronously with registration changes and connect/disconnect.
   */
  function syncUnloadListener() {
    const wanted = connected && active();
    if (wanted === unloadAttached) return;
    unloadAttached = wanted;
    if (wanted) window.addEventListener("beforeunload", onBeforeUnload);
    else window.removeEventListener("beforeunload", onBeforeUnload);
  }
  const publish = () => {
    deps.onSummary(summarize(selectedEntries(intent?.options)));
    syncUnloadListener();
  };

  function withOwnWrite(write: () => void) {
    ownWrite = true;
    try {
      write();
    } finally {
      ownWrite = false;
    }
  }

  function arm() {
    if (!connected || buffer !== null || removing || !active()) return;
    // A same-URL buffer left by a previous owner or document (remount,
    // reload) already duplicates this page: reuse it rather than stacking a
    // second dead Back step.
    const existing: unknown = window.history.state?.[GUARD_HISTORY_KEY];
    orphan = null;
    if (typeof existing === "string" && !abandonedMarkers.has(existing)) {
      buffer = {
        marker: existing,
        href: window.location.href,
        index: appHistoryIndex(),
      };
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
    buffer = {
      marker: id,
      href: window.location.href,
      index: appHistoryIndex(),
    };
  }

  /**
   * Native steps from the current entry back to the buffer, or undefined
   * when committed depth is unknown. Each committed app depth below the page
   * is one entry; the page's own unmarked entry shares the buffer's depth
   * and sits directly beneath it.
   */
  function stepsToBuffer(): number | undefined {
    const at = appHistoryIndex();
    const index = buffer?.index;
    if (at === undefined || index === undefined) return undefined;
    return at <= index ? index - at + 1 : index - at;
  }

  function traverse(delta: number) {
    if (delta === 1) window.history.forward();
    else if (delta === -1) window.history.back();
    else if (delta !== 0) window.history.go(delta);
  }

  /**
   * Continue a permitted browser traversal to the committed depth the user
   * chose (e.g. an earlier page from the Back menu), measured from wherever
   * buffer removal left history. Unknown depth falls back to one Back.
   */
  function traverseTo(target: number | undefined) {
    const at = appHistoryIndex();
    if (target === undefined || at === undefined) {
      window.history.back();
      return;
    }
    const delta = target - at;
    // Forward entries begin with the removed buffer, which is skipped.
    traverse(delta > 0 ? delta + 1 : delta);
  }

  function finishRemoval(): Approval | undefined {
    removing = false;
    buffer = null;
    restoredLocation = null;
    const approval = afterRemove;
    afterRemove = undefined;
    return approval;
  }

  function setIntent(next: Intent | null) {
    intent = next;
    deps.onPrompt(next !== null);
    publish();
  }

  /**
   * Run an approved action, unless work its decision did not cover is now
   * guarded: that needs a fresh explicit decision through the prompt (a
   * newer open request keeps precedence). Returns whether the action ran.
   */
  function continueApproved(approval: Approval | undefined): boolean {
    if (approval === undefined) return false;
    for (const [id, entry] of entries)
      if (approval.covered.get(id) !== entry) {
        if (intent === null) setIntent({ action: approval.action });
        return false;
      }
    executingApproval = approval;
    try {
      approval.action();
    } finally {
      executingApproval = undefined;
    }
    return true;
  }

  /** Remove the buffer (if any), then run `approval` from its popstate. */
  function removeBuffer(approval?: Approval) {
    if (approval) afterRemove = approval;
    if (removing) return;
    if (restoring) {
      removeRequested = true;
      return;
    }
    if (!connected) {
      // The shell is unmounting (or StrictMode is re-running its effects):
      // keep the buffer and any approval for a reconnect, and never traverse
      // or navigate while detached. A disposed owner never runs it.
      return;
    }
    if (buffer === null || !onBuffer()) {
      // Nothing to traverse: no buffer, or history already moved off it (a
      // route change unmounting the editor). Never step Back from a page the
      // buffer does not belong to.
      buffer = null;
      const next = afterRemove;
      afterRemove = undefined;
      if (next !== undefined && !continueApproved(next)) arm();
      return;
    }
    const state = { ...window.history.state };
    delete state[GUARD_HISTORY_KEY];
    restoredLocation = { url: window.location.href, state };
    removing = true;
    window.history.back();
  }

  function proceed(
    action: Transition,
    covered: ReadonlyMap<string, DraftRegistration> = NOTHING_COVERED,
  ) {
    // A permitted navigation supersedes any request still awaiting a decision.
    if (intent !== null) setIntent(null);
    announceNavigationIntent();
    removeBuffer({ action, covered });
  }

  function requestTransition(action: Transition, options?: TransitionOptions) {
    // Canonical entry points may be nested (shell -> warehouse store, task
    // completion -> router). One decision covers only the exact registrations
    // it already approved, never work reported during the continuation.
    if (
      executingApproval &&
      [...selectedEntries(options)].every(
        ([id, entry]) => executingApproval?.covered.get(id) === entry,
      )
    ) {
      action();
      return;
    }
    if (selectedEntries(options).size === 0 && options?.preserveDraftScope) {
      if (intent !== null) {
        intent.options?.onCancel?.();
        setIntent(null);
      }
      if (restoring || removing) {
        options.onCancel?.();
        return;
      }
      if (!options.entry) {
        proceed(() => {
          rearmAfterTraversal = true;
          action();
        }, new Map(entries));
        return;
      }
      if (options.entry && onBuffer()) {
        options.entry.claim = () => {
          if (!onBuffer()) return false;
          const state = { ...window.history.state };
          delete state[GUARD_HISTORY_KEY];
          withOwnWrite(() => window.history.replaceState(state, ""));
          buffer = null;
          return true;
        };
      }
      announceNavigationIntent();
      action();
      // Query pushes invoke onHistoryWrite, which arms the new entry. A
      // claimed buffer is a real step now and needs a fresh guard above it.
      if (active()) arm();
      return;
    }
    if (!active()) {
      proceed(action);
      return;
    }
    // A newer request supersedes an approval still waiting for its buffer
    // removal, whatever that approval covered: only this request continues.
    afterRemove = undefined;
    if (intent !== null) intent.options?.onCancel?.();
    setIntent({ action, options });
  }

  function sync() {
    publish();
    if (active()) arm();
    else if (buffer !== null) removeBuffer();
  }

  function update(id: string, entry: DraftRegistration | null) {
    if (settled.has(id)) {
      if (entry !== null && guarded(entry)) return;
      settled.delete(id);
    }
    const before = entries.get(id);
    if (attempt?.id === id) {
      // The attempt saves what its registration held when it began. A clean
      // report followed by guarded work, or turning dirty again while only
      // pending, is work the attempt cannot have saved.
      if (entry === null || !guarded(entry)) attempt.cleared = true;
      else if (
        attempt.cleared ||
        (before !== undefined && !before.dirty && entry.dirty)
      )
        attempt.renewed = true;
    }
    if (entry === null || !guarded(entry)) {
      if (before === undefined) return;
      entries.delete(id);
    } else {
      if (
        before !== undefined &&
        before.dirty === entry.dirty &&
        before.pending === entry.pending &&
        before.save === entry.save &&
        before.saveBlockedReason === entry.saveBlockedReason &&
        before.workflowScope === entry.workflowScope &&
        before.foregroundScope === entry.foregroundScope
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

  /** Keep editing: forget the requested action. Not while a save runs. */
  function keep() {
    if (attempt === null && intent !== null) {
      intent.options?.onCancel?.();
      setIntent(null);
    }
  }

  /** Dispose of every dirty draft, then continue the prompt's action. */
  function discard(): boolean {
    const current = intent;
    if (current === null || attempt !== null) return false;
    const values = [...selectedEntries(current.options).values()];
    if (values.some((entry) => entry.pending)) return false;
    // Disposed work may report clean only after the transition: it is
    // covered as reported now, while any later change is new work.
    const covered = new Map(entries);
    for (const entry of values) if (entry.dirty) entry.discard();
    if (current.options?.preserveDraftScope) {
      setIntent(null);
      proceed(() => {
        rearmAfterTraversal = true;
        current.action();
      }, covered);
    } else proceed(current.action, covered);
    return true;
  }

  /** Begin saving the sole dirty draft for the open prompt. */
  function beginSave(): Pick<SaveAttempt, "save"> | undefined {
    if (intent === null || attempt !== null) return undefined;
    const values = [...selectedEntries(intent.options)];
    const dirty = values.filter(([, entry]) => entry.dirty);
    const sole = dirty.length === 1 ? dirty[0] : undefined;
    if (sole === undefined || values.some(([, entry]) => entry.pending))
      return undefined;
    const [id, entry] = sole;
    if (entry.save === undefined || entry.saveBlockedReason) return undefined;
    attempt = { intent, id, save: entry.save, cleared: false, renewed: false };
    return attempt;
  }

  /**
   * Finish a save the owner began. Returns whether to show its failure. A
   * true result settles only the saved registration; the prompt's action
   * continues once only if that prompt is still current and nothing else
   * (including newer work in the saved draft) is guarded. Otherwise the
   * prompt stays for a fresh decision: nothing continues automatically.
   */
  function finishSave(token: Pick<SaveAttempt, "save">, saved: boolean) {
    if (attempt === null || attempt !== token) return false;
    const finished = attempt;
    attempt = null;
    const current = finished.intent === intent;
    if (!saved) return current;
    // Its React cleanup may report clean later (Floor does): until then its
    // stale guarded reports are this saved work, not new work.
    if (!finished.renewed && entries.has(finished.id)) {
      settled.add(finished.id);
      entries.delete(finished.id);
      publish();
    }
    if (
      current &&
      finished.intent.options?.preserveDraftScope &&
      selectedEntries(finished.intent.options).size === 0
    ) {
      setIntent(null);
      requestTransition(finished.intent.action, finished.intent.options);
      return false;
    }
    if (active()) return false;
    if (!current) {
      removeBuffer();
      return false;
    }
    proceed(finished.intent.action);
    return false;
  }

  function onPopState(event: PopStateEvent) {
    const left = overtaken;
    overtaken = null;
    if (removing) {
      // Consume only the buffer-removal traversal. The real transition
      // follows, with Next's original history state preserved.
      event.stopImmediatePropagation();
      const previous = restoredLocation;
      if (previous)
        withOwnWrite(() =>
          window.history.replaceState(previous.state, "", previous.url),
        );
      const approval = finishRemoval();
      refreshQueries();
      // An edit can arrive while an ordinary save removes the buffer, or
      // after an approval: guard it again rather than leave with it.
      if (!continueApproved(approval)) arm();
      return;
    }
    if (restoring) {
      event.stopImmediatePropagation();
      // Only the owned marker completes restoration. Depth-less entries
      // (no tracker) fall back to the guarded URL as before.
      const steps = onBuffer() ? 0 : stepsToBuffer();
      if (steps !== undefined && steps !== 0 && restoreCorrections < 2) {
        // Landed beside the buffer (e.g. its unmarked base): re-aim without
        // touching the user's original destination.
        restoreCorrections += 1;
        traverse(steps);
        return;
      }
      if (
        steps === undefined &&
        window.location.href !== buffer?.href &&
        restoreCorrections < 2
      ) {
        restoreCorrections += 1;
        window.history.forward();
        return;
      }
      restoring = false;
      const restoredAction = afterRestore;
      afterRestore = undefined;
      restoreCorrections = 0;
      // The cancelled traversal never reached query subscribers; refresh them.
      refreshQueries();
      if (removeRequested) {
        removeRequested = false;
        removeBuffer();
      }
      restoredAction?.();
      return;
    }
    if (buffer === null || !active()) {
      if (buffer === null) {
        skipOrphanBase(event);
        if (rearmAfterTraversal) {
          rearmAfterTraversal = false;
          if (active()) queueMicrotask(() => arm());
        }
      }
      return;
    }
    // Remember where the user was going (a Back-menu entry may be several
    // pages away), then restore the buffer without unmounting the editor.
    const landed = appHistoryIndex();
    const index = buffer.index;
    const target =
      landed === undefined || index === undefined
        ? undefined
        : // Leaving the buffer onto its own unmarked page is one page Back.
          landed === index
          ? index - 1
          : landed;
    // From the overtaken buffer's base, that buffer is the next entry; the
    // remaining distance is re-aimed from there (see `overtaken`).
    const steps =
      left !== null &&
      window.history.state?.[GUARD_HISTORY_KEY] !== left.marker &&
      landed === left.index &&
      samePage(window.location.href, left.href)
        ? 1
        : stepsToBuffer();
    event.stopImmediatePropagation();
    restoring = true;
    restoreCorrections = 0;
    traverse(steps ?? 1);
    if (landed === index && hasBackWithinPage()) {
      afterRestore = () => {
        if (connected && !backWithinPage())
          requestTransition(() => traverseTo(target));
      };
    } else requestTransition(() => traverseTo(target));
  }

  /**
   * Back from an unowned guard entry lands on its unmarked base: the same
   * page at the same committed depth. That step is invisible to the user, so
   * continue it once to the previous committed page. The intermediate event
   * is consumed; the continued Back reaches Next and query readers normally.
   */
  function skipOrphanBase(event: PopStateEvent) {
    const left = orphan;
    noteOrphan();
    if (
      left !== null &&
      orphan === null &&
      window.history.state?.[GUARD_HISTORY_KEY] !== left.marker &&
      samePage(window.location.href, left.href) &&
      appHistoryIndex() === left.index
    ) {
      event.stopImmediatePropagation();
      window.history.back();
    }
  }

  /**
   * A tracked write either replaced the unowned guard entry in place (e.g. a
   * Map/List query replacement keeps its marker and depth) or left it. Keep
   * the orphan, with its new URL, only while the current entry still carries
   * the same marker at the same committed depth on the same route.
   */
  function reconcileOrphan() {
    const left = orphan;
    if (left === null) return;
    const marker: unknown = window.history.state?.[GUARD_HISTORY_KEY];
    orphan =
      buffer === null &&
      marker === left.marker &&
      !abandonedMarkers.has(left.marker) &&
      appHistoryIndex() === left.index &&
      samePage(window.location.href, left.href)
        ? { ...left, href: window.location.href }
        : null;
  }

  /**
   * Whether a write kept the guarded page: an in-place replacement on the
   * same route that kept the buffer's marker, or a new entry pushed above it
   * on the same route (e.g. a pushed query). Either keeps the editor mounted
   * with its work. Unknown depth is not treated as the same page.
   */
  function keptGuardedPage(): boolean {
    const at = appHistoryIndex();
    const index = buffer?.index;
    return (
      buffer !== null &&
      index !== undefined &&
      at !== undefined &&
      samePage(window.location.href, buffer.href) &&
      (at > index || (at === index && onBuffer()))
    );
  }

  /**
   * Another write moved history while the owner was traversing its buffer.
   * The queued traversal is no longer ours to recognise, so drop the stale
   * state rather than let it consume a later, real Back. That navigation
   * also supersedes any approved action waiting for the removal; work still
   * guarded on the same page stays protected.
   */
  function onHistoryWrite() {
    if (ownWrite) return;
    // A write on the fresh buffer (e.g. a same-URL report or an in-place
    // query replacement) cannot remove the overtaken buffer below it.
    if (!onBuffer()) overtaken = null;
    reconcileOrphan();
    if (removing || restoring) {
      // Decide before clearing the buffer this write overtook.
      const kept = keptGuardedPage();
      const leaving =
        removing && buffer !== null && buffer.index !== undefined
          ? { marker: buffer.marker, href: buffer.href, index: buffer.index }
          : null;
      restoring = false;
      restoreCorrections = 0;
      removeRequested = false;
      const superseded = finishRemoval();
      refreshQueries();
      // Re-arm unless the cancelled approval's departure took the page away.
      // The traversal may still be delivered; arming makes it an ordinary
      // guarded Back rather than an unprotected one.
      if (!superseded || kept) arm();
      // A push above the page leaves the old buffer below the fresh one. An
      // in-place replacement re-adopts it, where its base is already one
      // step below and nothing needs recording.
      if (
        kept &&
        leaving !== null &&
        buffer !== null &&
        buffer.marker !== leaving.marker
      )
        overtaken = leaving;
      return;
    }
    // A write that bypassed the guard left the buffer behind. Stop tracking
    // the entry we left; it stays in history as an unowned guard entry.
    if (buffer !== null && !onBuffer()) {
      // Decide before clearing: a push of a new entry above the guarded page
      // on the same route keeps the editor mounted with its work. A route
      // departure, or a replacement that dropped the marker in place,
      // re-arms only on the next registration change.
      const pushedOnPage = keptGuardedPage();
      buffer = null;
      // Guard the new entry now. The tracker stripped the copied marker, so
      // arm() pushes a fresh buffer. Next's patched pushState passes that
      // nested push through (it carries the `__NA` Next copied into this
      // entry), and Next's later same-URL replacement keeps its marker.
      if (pushedOnPage) arm();
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
      cancelTransition: (intentOwner) => {
        if (intent?.options?.intentOwner !== intentOwner || attempt !== null)
          return;
        intent.options.onCancel?.();
        setIntent(null);
      },
      isTraversing: traversing,
    });
    const unsubscribe = subscribeHistoryWrites(onHistoryWrite);
    window.addEventListener("popstate", onPopState, true);
    document.addEventListener("click", onClick, true);
    // Reconcile entries registered while detached (child effects run first).
    // A surviving buffer with nothing to guard is never traversed on mount;
    // the first Back from it skips its duplicate base (skipOrphanBase).
    publish();
    if (active()) arm();
    else noteOrphan();
    // An approval made while detached (child effects before the first
    // connect, or StrictMode's effect re-run) runs only once the owner is
    // connected. One made during an earlier connection never survives it.
    if (afterRemove !== undefined && !removing && !restoring) removeBuffer();
    return () => {
      connected = false;
      if (removing || restoring) {
        // A traversal this connection queued can no longer be recognised:
        // its event may arrive while detached, so a reconnect must not read
        // the next real Back as it, nor a successor adopt the buffer it is
        // leaving. The approval waiting for it belonged to this connection.
        if (buffer !== null) abandonedMarkers.add(buffer.marker);
        restoring = false;
        restoreCorrections = 0;
        removeRequested = false;
        finishRemoval();
      }
      // Its prompt and any save in flight belong to this connection only.
      attempt = null;
      overtaken = null;
      if (intent !== null) setIntent(null);
      release();
      unsubscribe();
      window.removeEventListener("popstate", onPopState, true);
      document.removeEventListener("click", onClick, true);
      syncUnloadListener();
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
    keep,
    discard,
    beginSave,
    finishSave,
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
