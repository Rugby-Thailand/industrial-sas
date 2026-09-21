"use client";

import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { LOCALES, type AppLocale } from "@/i18n/routing";
import { useCallback, useLayoutEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const HISTORY_KEY = "__storageWorkspaceGuard";
// Window-targeted popstate listeners run in registration order, so an older
// router/subscription can observe a buffer traversal before this hook restores
// it. Query consumers must skip those temporary URLs while this signal is true.
const activeHistoryGuards = new Set<string>();
export function isWorkspaceHistoryGuardActive(): boolean {
  return activeHistoryGuards.size > 0;
}
type Transition = () => void;
interface GuardOptions {
  readonly dirty: boolean;
  readonly save: () => Promise<boolean>;
  readonly discard: () => void;
  readonly pending: boolean;
  readonly saveBlockedReason?: string;
}

/** All programmatic workspace transitions must pass through requestTransition. */
export function useWorkspaceNavigationGuard(options: GuardOptions) {
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const latest = useRef(options);
  const [prompt, setPrompt] = useState<{ action: Transition } | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const buffered = useRef(false);
  const restoring = useRef(false);
  const removing = useRef(false);
  const removeRequested = useRef(false);
  const afterRemove = useRef<Transition | undefined>(undefined);
  const restoredLocation = useRef<{ url: string; state: unknown } | null>(null);
  const removeBufferRef = useRef<(action?: Transition) => void>(() => {});
  const armBufferRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    latest.current = options;
  }, [options]);

  const requestTransition = useCallback((action: Transition) => {
    if (busy.current) return;
    if (!latest.current.dirty && !latest.current.pending) {
      removeBufferRef.current(action);
      return;
    }
    setFailed(false);
    setPrompt({ action });
  }, []);

  useLayoutEffect(() => {
    if (buffered.current) activeHistoryGuards.add(id);
    function armBuffer() {
      if (
        buffered.current ||
        removing.current ||
        (!latest.current.dirty && !latest.current.pending)
      )
        return;
      activeHistoryGuards.add(id);
      window.history.pushState(
        { ...window.history.state, [HISTORY_KEY]: id },
        "",
        window.location.href,
      );
      buffered.current = true;
    }
    armBufferRef.current = armBuffer;

    function removeBuffer(action?: Transition) {
      if (action) afterRemove.current = action;
      if (removing.current) return;
      if (restoring.current) {
        removeRequested.current = true;
        return;
      }
      if (!buffered.current) {
        activeHistoryGuards.delete(id);
        const next = afterRemove.current;
        afterRemove.current = undefined;
        next?.();
        return;
      }
      const state = { ...window.history.state };
      delete state[HISTORY_KEY];
      restoredLocation.current = { url: window.location.href, state };
      removing.current = true;
      window.history.back();
    }
    removeBufferRef.current = removeBuffer;

    function onPopState(event: PopStateEvent) {
      if (removing.current) {
        // Consume only the same-document buffer traversal. The real transition
        // follows after this, with Next's original history state preserved.
        event.stopImmediatePropagation();
        const previous = restoredLocation.current;
        if (previous)
          window.history.replaceState(previous.state, "", previous.url);
        removing.current = false;
        buffered.current = false;
        activeHistoryGuards.delete(id);
        const action = afterRemove.current;
        afterRemove.current = undefined;
        action?.();
        // An edit can arrive while an ordinary save is removing its buffer.
        // Re-arm it before the user can leave with that newer draft.
        if (!action) armBuffer();
        return;
      }
      if (restoring.current && event.state?.[HISTORY_KEY] === id) {
        event.stopImmediatePropagation();
        restoring.current = false;
        if (removeRequested.current) {
          removeRequested.current = false;
          removeBuffer();
        }
        return;
      }
      if (
        !buffered.current ||
        (!latest.current.dirty && !latest.current.pending)
      )
        return;
      // Restore the same-route buffer without unmounting the editor. Cached
      // workspace query consumers ignore this traversal via the shared signal.
      event.stopImmediatePropagation();
      restoring.current = true;
      window.history.forward();
      requestTransition(() => window.history.back());
    }

    function onClick(event: MouseEvent) {
      if (
        (!latest.current.dirty && !latest.current.pending) ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
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
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestTransition(() => {
        // next-intl's router adds the locale prefix itself, so strip it from
        // the intercepted absolute URL to avoid /en/en or /th/th.
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
          destinationLocale === undefined
            ? undefined
            : { locale: destinationLocale },
        );
      });
    }

    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!latest.current.dirty && !latest.current.pending) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("popstate", onPopState, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      activeHistoryGuards.delete(id);
      window.removeEventListener("popstate", onPopState, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [id, requestTransition, router]);

  useLayoutEffect(() => {
    if (options.dirty || options.pending) {
      // Arm before paint so a fast Back cannot beat passive effects.
      armBufferRef.current();
    } else if (buffered.current) {
      removeBufferRef.current();
    }
  }, [id, options.dirty, options.pending]);

  const thai = locale === "th";
  const labels = {
    title: thai
      ? "บันทึกการเปลี่ยนแปลงก่อนออก?"
      : "Save changes before leaving?",
    description: thai
      ? "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก เลือกบันทึก ละทิ้ง หรือแก้ไขต่อ"
      : "You have unsaved changes. Save them, discard them, or keep editing.",
    save: thai ? "บันทึกและดำเนินการต่อ" : "Save and continue",
    discard: thai ? "ละทิ้งการเปลี่ยนแปลง" : "Discard changes",
    keep: thai ? "แก้ไขต่อ" : "Keep editing",
    close: thai ? "ปิดหน้าต่าง" : "Close dialog",
    saving: thai ? "กำลังบันทึก…" : "Saving…",
    failed: thai
      ? "ยังบันทึกไม่ได้ การเปลี่ยนแปลงของคุณยังอยู่ กรุณาตรวจสอบแล้วลองอีกครั้ง"
      : "Could not save. Your changes are still here. Review them and try again.",
  };
  const disabled = saving || options.pending;

  async function saveAndContinue() {
    if (
      !prompt ||
      busy.current ||
      latest.current.pending ||
      latest.current.saveBlockedReason
    )
      return;
    busy.current = true;
    setSaving(true);
    setFailed(false);
    try {
      if (!(await latest.current.save())) {
        setFailed(true);
        return;
      }
      setPrompt(null);
      removeBufferRef.current(prompt.action);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const navigationPrompt = (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open && !disabled) setPrompt(null);
      }}
    >
      <DialogContent closeLabel={labels.close} showCloseButton={!disabled}>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        {options.saveBlockedReason ? (
          <p role="status" className="text-sm text-warning">
            {options.saveBlockedReason}
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
            disabled={disabled}
            onClick={() => setPrompt(null)}
          >
            {labels.keep}
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => {
              if (!prompt || busy.current || latest.current.pending) return;
              latest.current.discard();
              setPrompt(null);
              removeBufferRef.current(prompt.action);
            }}
          >
            {labels.discard}
          </Button>
          <Button
            disabled={disabled || Boolean(options.saveBlockedReason)}
            onClick={() => void saveAndContinue()}
          >
            {saving ? labels.saving : labels.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { requestTransition, navigationPrompt };
}
