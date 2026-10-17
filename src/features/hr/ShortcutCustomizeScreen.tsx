"use client";

import { useMutation, useQuery } from "convex/react";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useDraftGuard } from "@/components/providers/draftGuard";
import { OutcomeGate } from "@/components/system/DataGate";
import { CheckboxField } from "@/components/ui/CheckboxControl";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { hrRefs } from "@/lib/convex/hrApi";
import type { RefValue } from "@/lib/convex/clientRef";
import { HR_CODES, ROUTES } from "@/lib/navigation";
import { useRouter } from "@/i18n/navigation";
import { returnFromTask } from "@/lib/taskNavigation";

import { HrGate, WriteFeedback } from "./HrShared";
import {
  HR_SHORTCUTS,
  HrShortcutCards,
  type HrShortcutPreference,
} from "./HrShortcuts";
import { useHrWrite } from "./useHrWrite";

type Preferences = Extract<
  RefValue<typeof hrRefs.shortcutPreferences>,
  { ok: true }
>;
type SavedPreferences = Extract<
  RefValue<typeof hrRefs.saveShortcutPreferences>,
  { written: true }
>;

interface PreferenceCommand {
  readonly expectedVersion: number;
  readonly shortcuts: readonly HrShortcutPreference[];
}
function preferenceCommand(value: unknown): PreferenceCommand | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("expectedVersion" in value) ||
    typeof value.expectedVersion !== "number" ||
    !Number.isInteger(value.expectedVersion) ||
    !("shortcuts" in value) ||
    !Array.isArray(value.shortcuts) ||
    value.shortcuts.length !== HR_SHORTCUTS.length
  )
    return undefined;
  const keys = new Set<string>();
  for (const item of value.shortcuts) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.key !== "string" ||
      typeof item.visible !== "boolean" ||
      keys.has(item.key) ||
      !HR_SHORTCUTS.some((shortcut) => shortcut.key === item.key)
    )
      return undefined;
    keys.add(item.key);
  }
  return {
    expectedVersion: value.expectedVersion,
    shortcuts: value.shortcuts.map((item) => ({
      key: item.key as string,
      visible: item.visible as boolean,
    })),
  };
}

function validSavedShortcuts(
  shortcuts: readonly HrShortcutPreference[],
): shortcuts is Preferences["shortcuts"] {
  return (
    new Set(shortcuts.map((item) => item.key)).size === shortcuts.length &&
    shortcuts.every((item) =>
      HR_SHORTCUTS.some((known) => known.key === item.key),
    )
  );
}

export function HrShortcutCustomizeScreen() {
  const t = useTranslations("Hr.shortcuts");
  return (
    <>
      <PageHeader
        title={t("title")}
        summary={t("summary")}
        breadcrumbs={[{ label: t("items.today.label"), href: ROUTES.hrToday }]}
      />
      <HrGate code={HR_CODES.self} allowUnsupportedTimezone>
        <CustomizeContent />
      </HrGate>
    </>
  );
}

function CustomizeContent() {
  const t = useTranslations("Hr.shortcuts");
  const identity = useHrAccess().identityKey;
  const preferences = useQuery(hrRefs.shortcutPreferences, {});
  return (
    <OutcomeGate outcome={preferences}>
      {({ value }) =>
        value.ok ? (
          <ShortcutEditor key={identity} preferences={value} />
        ) : (
          <Notice tone="neutral" title={t("notLinked")} />
        )
      }
    </OutcomeGate>
  );
}

interface Sorting {
  readonly key: string;
  readonly handle: HTMLButtonElement | undefined;
  readonly capture: HTMLElement | undefined;
  readonly before: readonly HrShortcutPreference[];
  readonly pointerId?: number;
  y?: number;
}

function ShortcutEditor({
  preferences,
}: {
  readonly preferences: Preferences;
}) {
  const t = useTranslations("Hr.shortcuts");
  const save = useMutation(hrRefs.saveShortcutPreferences);
  const router = useRouter();
  const write = useHrWrite<SavedPreferences, PreferenceCommand>(
    "shortcut-preferences",
    {
      decode: preferenceCommand,
      send: async (payload, requestId) => {
        const outcome = await save({
          requestId,
          expectedVersion: payload.expectedVersion,
          shortcuts: payload.shortcuts,
        });
        if (
          outcome.ok &&
          outcome.value.written === true &&
          (typeof outcome.value.version !== "number" ||
            outcome.value.shortcuts === undefined ||
            !validSavedShortcuts(outcome.value.shortcuts))
        )
          return undefined;
        return outcome;
      },
    },
  );
  const [baseline, setBaseline] = useState<
    Preferences & { readonly recovered?: boolean }
  >(() =>
    write.recoveredPayload
      ? {
          ...preferences,
          version: write.recoveredPayload.expectedVersion,
          recovered: true,
        }
      : preferences,
  );
  const [consumedReceipt, setConsumedReceipt] = useState<SavedPreferences>();
  const [draft, setDraft] = useState<readonly HrShortcutPreference[]>(
    write.recoveredPayload?.shortcuts ?? preferences.shortcuts,
  );
  const latest = useRef(draft);
  const sorting = useRef<Sorting | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocus = useRef<string | null>(null);
  // The saved recovery payload is an owned draft, including after a stale
  // refusal. A newer query cannot silently rebase it into a fresh overwrite.
  const dirty =
    baseline.recovered === true ||
    JSON.stringify(draft) !== JSON.stringify(baseline.shortcuts);

  const receipt = write.state.kind === "SAVED" ? write.state.value : undefined;
  // Completion belongs to the shared command owner. It can settle after this
  // editor remounts, without the original persist() callback running here.
  // Consume each receipt once, before controls unlock for a subsequent draft.
  if (
    receipt &&
    receipt !== consumedReceipt &&
    typeof receipt.version === "number" &&
    receipt.shortcuts !== undefined &&
    validSavedShortcuts(receipt.shortcuts)
  ) {
    setConsumedReceipt(receipt);
    const saved = {
      ok: true as const,
      version: receipt.version,
      shortcuts: receipt.shortcuts,
    };
    const current = preferences.version >= saved.version ? preferences : saved;
    const next = baseline.version > current.version ? baseline : current;
    setBaseline({ ...next, recovered: false });
    setDraft(next.shortcuts);
  } else if (
    !dirty &&
    !write.locked &&
    activeKey === null &&
    preferences.version > baseline.version
  ) {
    // Clean editors follow newer live data; owned drafts retain their version.
    setBaseline(preferences);
    setDraft(preferences.shortcuts);
  }

  const replace = useCallback((next: readonly HrShortcutPreference[]) => {
    latest.current = next;
    setDraft(next);
  }, []);
  useLayoutEffect(() => {
    latest.current = draft;
    if (restoreFocus.current === null) return;
    handles.current.get(restoreFocus.current)?.focus({ preventScroll: true });
    restoreFocus.current = null;
  }, [draft, activeKey]);
  const finishSort = useCallback(
    (commit: boolean) => {
      const operation = sorting.current;
      if (operation === null) return;
      sorting.current = null;
      restoreFocus.current = operation.key;
      if (!commit) replace(operation.before);
      setActiveKey(null);
      const handle = handles.current.get(operation.key) ?? operation.handle;
      if (
        operation.pointerId !== undefined &&
        operation.capture?.hasPointerCapture?.(operation.pointerId)
      )
        operation.capture.releasePointerCapture(operation.pointerId);
      handle?.focus({ preventScroll: true });
      setAnnouncement(t(commit ? "dropped" : "reorderCancelled"));
    },
    [replace, t],
  );
  useEffect(() => {
    const cancel = () => finishSort(false);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      const operation = sorting.current;
      sorting.current = null;
      if (operation?.pointerId === undefined) return;
      if (operation.capture?.hasPointerCapture?.(operation.pointerId))
        operation.capture.releasePointerCapture(operation.pointerId);
    };
  }, [finishSort]);
  function reset() {
    finishSort(false);
    const current =
      preferences.version >= baseline.version ? preferences : baseline;
    setBaseline({ ...current, recovered: false });
    replace(current.shortcuts);
    write.reset();
    restoreFocus.current = current.shortcuts[0]?.key ?? null;
    handles.current.get(current.shortcuts[0]?.key ?? "")?.focus();
  }
  useDraftGuard(dirty && !write.locked, reset, write.pending);

  const move = useCallback(
    (key: string, target: number) => {
      const items = [...latest.current];
      const from = items.findIndex((item) => item.key === key);
      const to = Math.max(0, Math.min(target, items.length - 1));
      if (from === to || from < 0) return;
      const item = items.splice(from, 1)[0]!;
      items.splice(to, 0, item);
      restoreFocus.current = key;
      replace(items);
      const shortcut = HR_SHORTCUTS.find((candidate) => candidate.key === key)!;
      setAnnouncement(
        t("moved", {
          label: t(`items.${shortcut.name}.label`),
          position: to + 1,
          total: items.length,
        }),
      );
    },
    [replace, t],
  );
  const moveAtPointer = useCallback(
    (operation: Sorting) => {
      if (operation.y === undefined) return;
      const rows = [
        ...(list.current?.querySelectorAll<HTMLElement>(
          "[data-shortcut-key]",
        ) ?? []),
      ].filter((row) => row.dataset.shortcutKey !== operation.key);
      const before = rows.findIndex((row) => {
        const rect = row.getBoundingClientRect();
        return operation.y! < rect.top + rect.height / 2;
      });
      move(operation.key, before < 0 ? rows.length : before);
    },
    [move],
  );
  useEffect(() => {
    if (activeKey === null || sorting.current?.pointerId === undefined) return;
    let frame = 0;
    const scroll = () => {
      const operation = sorting.current;
      if (operation?.y === undefined || operation.pointerId === undefined)
        return;
      const main = list.current?.closest("main");
      const bounds = main?.getBoundingClientRect();
      const step =
        operation.y < (bounds?.top ?? 0) + 80
          ? -12
          : operation.y > (bounds?.bottom ?? window.innerHeight) - 88
            ? 12
            : 0;
      if (step !== 0) {
        const container = main ?? document.scrollingElement;
        if (container !== null) container.scrollTop += step;
        moveAtPointer(operation);
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [activeKey, moveAtPointer]);

  function begin(key: string, event?: PointerEvent<HTMLButtonElement>) {
    if (write.locked || sorting.current !== null) return;
    sorting.current = {
      key,
      handle: handles.current.get(key),
      capture:
        event === undefined ? undefined : (list.current ?? event.currentTarget),
      before: latest.current,
      ...(event === undefined
        ? {}
        : { pointerId: event.pointerId, y: event.clientY }),
    };
    setActiveKey(key);
    write.reset();
    setAnnouncement(t("lifted"));
    if (event !== undefined)
      sorting.current.capture?.setPointerCapture?.(event.pointerId);
  }
  function keyboard(key: string, event: KeyboardEvent<HTMLButtonElement>) {
    if (write.locked) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (sorting.current?.key === key) finishSort(true);
      else begin(key);
      return;
    }
    if (sorting.current?.key !== key) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finishSort(false);
      return;
    }
    const index = latest.current.findIndex((item) => item.key === key);
    const target = {
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      Home: 0,
      End: latest.current.length - 1,
    }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      move(key, target);
    }
  }
  async function persist(retry = false) {
    const payload = latest.current.map((item) => ({ ...item }));
    if (retry) await write.retry();
    else
      await write.submitCommand({
        expectedVersion: baseline.version,
        shortcuts: payload,
      });
  }

  return (
    <div className="grid gap-group lg:grid-cols-2">
      <Panel
        aria-labelledby="shortcut-order-heading"
        className="space-y-section"
      >
        <SectionHeader
          id="shortcut-order-heading"
          title={t("yourMenus")}
          description={t("count", {
            visible: draft.filter((item) => item.visible).length,
            total: draft.length,
          })}
        />
        <ol
          ref={list}
          aria-label={t("order")}
          className="divide-y divide-border"
          onPointerMove={(event) => {
            const operation = sorting.current;
            if (
              operation === null ||
              operation.pointerId === undefined ||
              operation.pointerId !== event.pointerId
            )
              return;
            operation.y = event.clientY;
            moveAtPointer(operation);
          }}
          onPointerUp={(event) => {
            if (
              sorting.current?.pointerId !== undefined &&
              sorting.current.pointerId === event.pointerId
            )
              finishSort(true);
          }}
          onPointerCancel={() => finishSort(false)}
          onLostPointerCapture={() => {
            if (sorting.current?.pointerId !== undefined) finishSort(false);
          }}
        >
          {draft.map((item, index) => {
            const shortcut = HR_SHORTCUTS.find(
              (candidate) => candidate.key === item.key,
            )!;
            const Icon = shortcut.icon;
            const label = t(`items.${shortcut.name}.label`);
            return (
              <li
                key={item.key}
                data-shortcut-key={item.key}
                className="flex min-w-0 items-center gap-3 py-2"
              >
                <Button
                  ref={(node) => {
                    if (node) handles.current.set(item.key, node);
                    else handles.current.delete(item.key);
                  }}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="cursor-grab touch-none aria-pressed:cursor-grabbing"
                  aria-label={t("handle", {
                    label,
                    position: index + 1,
                    total: draft.length,
                  })}
                  aria-describedby="shortcut-drag-help"
                  aria-pressed={activeKey === item.key}
                  disabled={
                    write.locked ||
                    (activeKey !== null && activeKey !== item.key)
                  }
                  onKeyDown={(event) => keyboard(item.key, event)}
                  onClick={(event) => {
                    if (event.detail !== 0) return;
                    if (sorting.current?.key === item.key) finishSort(true);
                    else begin(item.key);
                  }}
                  onPointerDown={(event) => {
                    if (event.button === 0 && event.isPrimary !== false) {
                      event.preventDefault();
                      begin(item.key, event);
                      event.currentTarget.focus();
                    }
                  }}
                >
                  <GripVertical aria-hidden="true" className="size-4" />
                </Button>
                <Icon
                  aria-hidden="true"
                  className="size-5 shrink-0 text-link"
                />
                <span className="min-w-0 flex-1 text-sm font-semibold">
                  {label}
                </span>
                <CheckboxField
                  label={t("show")}
                  aria-label={t("showLabel", { label })}
                  checked={item.visible}
                  disabled={write.locked || activeKey !== null}
                  onChange={(event) => {
                    const visible = event.target.checked;
                    replace(
                      latest.current.map((candidate) =>
                        candidate.key === item.key
                          ? { ...candidate, visible }
                          : candidate,
                      ),
                    );
                    write.reset();
                  }}
                />
              </li>
            );
          })}
        </ol>
        <p id="shortcut-drag-help" className="text-sm text-muted">
          {t("help")}
        </p>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <p className="text-sm text-muted">
          {t(dirty ? "unsaved" : "unchanged")}
        </p>
        {write.state.kind === "REFUSED" &&
        write.state.code === "PREFERENCES_STALE" ? (
          // A stale save has one recovery path, so it replaces the generic
          // "correct it and try again" refusal instead of contradicting it.
          <Notice
            tone="warning"
            role="alert"
            title={t("stale")}
            body={t("staleHint")}
            testId="hr-shortcuts-stale"
          />
        ) : (
          <WriteFeedback
            state={write.state}
            saved={
              <p role="status" className="text-sm font-semibold text-success">
                {t("saved")}
              </p>
            }
            onRetry={() => void persist(true)}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={reset}
            disabled={write.locked}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void persist()}
            disabled={!dirty || write.locked || activeKey !== null}
          >
            {t("save")}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() =>
              returnFromTask(
                `${ROUTES.hrToday}#hr-customize-shortcuts`,
                router.replace,
              )
            }
          >
            {t("back")}
          </Button>
        </div>
      </Panel>
      <Panel
        appearance="plain"
        aria-labelledby="shortcut-preview-heading"
        className="space-y-section"
      >
        <SectionHeader id="shortcut-preview-heading" title={t("preview")} />
        <HrShortcutCards shortcuts={draft} preview />
        <p className="text-sm text-muted">{t("clockHint")}</p>
      </Panel>
    </div>
  );
}
