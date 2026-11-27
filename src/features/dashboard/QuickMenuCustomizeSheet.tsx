"use client";

import { ArrowDown, ArrowUp, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { Button } from "@/components/ui/button";
import {
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { QuickMenuKey as MenuKey } from "../../../convex/model/home/quickMenu";
import { quickMenuTile } from "./quickMenuCatalog";

export interface QuickMenuEditorProps {
  readonly pinned: readonly MenuKey[];
  readonly available: readonly MenuKey[];
  readonly onChange: (pinned: MenuKey[]) => void;
  readonly canEdit: boolean;
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly operation: "save" | "resend" | "verify";
  readonly save?: ((closeAfterSave?: boolean) => Promise<boolean>) | undefined;
  readonly discard: () => void;
  readonly status: string;
  readonly readRetry?: (() => void) | undefined;
  readonly verify?: (() => void) | undefined;
  readonly resend?: (() => void) | undefined;
  readonly resetInvalid?: (() => void) | undefined;
  readonly dismissUnavailable?: (() => void) | undefined;
}

export function QuickMenuCustomizeSheet(props: QuickMenuEditorProps) {
  const t = useTranslations("Home");
  const desktop = useMediaQuery("(min-width: 768px)");
  return (
    <SheetContent
      side={desktop ? "right" : "bottom"}
      className="max-h-[90dvh] gap-0 rounded-t-2xl bg-surface data-[side=right]:max-h-none data-[side=right]:w-full data-[side=right]:max-w-md data-[side=right]:rounded-none"
      closeLabel={t("close")}
      showCloseButton={!props.pending}
    >
      <SheetHeader className="shrink-0 border-b border-border pe-16">
        <SheetTitle>{t("customizeTitle")}</SheetTitle>
        <SheetDescription>{t("customizeDescription")}</SheetDescription>
      </SheetHeader>
      <QuickMenuEditor {...props} />
    </SheetContent>
  );
}

function QuickMenuEditor({
  pinned,
  available,
  onChange,
  canEdit,
  dirty,
  pending,
  operation,
  save,
  discard,
  status,
  readRetry,
  verify,
  resend,
  dismissUnavailable,
  resetInvalid,
}: QuickMenuEditorProps) {
  const t = useTranslations("Home");
  const labels = useTranslations("Navigation");
  useNavigationDraft({
    dirty,
    pending,
    discard,
    ...(save ? { save } : {}),
    ...(pending
      ? {
          pendingStatusMessage: t(
            operation === "verify" ? "checking" : "saving",
          ),
        }
      : {}),
    ...(dirty && status && !save ? { saveBlockedReason: status } : {}),
  });
  const [announcement, setAnnouncement] = useState("");
  const cancelButton = useRef<HTMLButtonElement>(null);
  const focusId = useRef<string | undefined>(undefined);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    focusId.current = undefined;
    const next = rowButtons.current.get(id);
    if (next && !next.disabled) next.focus();
    else cancelButton.current?.focus();
  }, [pinned, available]);

  const unpinned = available.filter((key) => !pinned.includes(key));
  function edit(
    key: MenuKey,
    index: number,
    action: "up" | "down" | "pin" | "unpin",
  ) {
    const label = labels(quickMenuTile(key).labelKey);
    if (action === "pin") {
      const next = unpinned[index + 1] ?? unpinned[index - 1];
      focusId.current = next ? `pin:${next}` : `unpin:${key}`;
      setAnnouncement(t("pinnedStatus", { label }));
      onChange([...pinned, key]);
      return;
    }
    if (action === "unpin") {
      const next = pinned[index + 1] ?? pinned[index - 1];
      focusId.current = next ? `unpin:${next}` : `pin:${key}`;
      setAnnouncement(t("unpinnedStatus", { label }));
      onChange(pinned.filter((entry) => entry !== key));
      return;
    }
    const next = index + (action === "up" ? -1 : 1);
    const reordered = [...pinned];
    [reordered[index], reordered[next]] = [reordered[next]!, key];
    const atBoundary =
      action === "up" ? next === 0 : next === pinned.length - 1;
    focusId.current = `${atBoundary ? (action === "up" ? "down" : "up") : action}:${key}`;
    setAnnouncement(t("movedStatus", { label, position: next + 1 }));
    onChange(reordered);
  }

  function rowButton(
    key: MenuKey,
    index: number,
    action: "up" | "down" | "pin" | "unpin",
    disabled = false,
  ) {
    const label = labels(quickMenuTile(key).labelKey);
    const actionKey = {
      up: "moveUp",
      down: "moveDown",
      pin: "pin",
      unpin: "unpin",
    } as const;
    const Icon = { up: ArrowUp, down: ArrowDown, pin: Plus, unpin: Minus }[
      action
    ];
    const id = `${action}:${key}`;
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="min-h-11 min-w-10"
        ref={(element) => {
          if (element) rowButtons.current.set(id, element);
          else rowButtons.current.delete(id);
        }}
        aria-label={t(actionKey[action], { label })}
        disabled={!canEdit || disabled}
        onClick={() => edit(key, index, action)}
      >
        <Icon aria-hidden />
      </Button>
    );
  }

  function row(key: MenuKey, actions: ReactNode) {
    const { Icon, labelKey } = quickMenuTile(key);
    return (
      <li
        key={key}
        className="flex min-h-12 items-center gap-2 rounded-lg border border-border bg-raised py-0.5 ps-3 pe-1"
      >
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 font-medium break-words">
          {labels(labelKey)}
        </span>
        <div className="flex shrink-0">{actions}</div>
      </li>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
        {status && (
          <div className="space-y-2 rounded-lg border border-border bg-raised p-3 text-sm leading-5">
            <p role="status">{status}</p>
            {(readRetry ||
              resend ||
              dismissUnavailable ||
              resetInvalid ||
              verify) && (
              <div className="flex flex-wrap gap-2">
                {readRetry && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={readRetry}
                    disabled={pending}
                  >
                    {t("retry")}
                  </Button>
                )}
                {resend && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resend}
                    disabled={pending && operation !== "resend"}
                    pending={pending && operation === "resend"}
                    pendingLabel={t("saving")}
                  >
                    {t("resend")}
                  </Button>
                )}
                {dismissUnavailable && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={dismissUnavailable}
                  >
                    {t(dirty ? "discardEditsUseLatest" : "keepLatest")}
                  </Button>
                )}
                {resetInvalid && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetInvalid}
                    disabled={pending}
                  >
                    {t("resetRecovery")}
                  </Button>
                )}
                {verify && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={verify}
                    disabled={pending && operation !== "verify"}
                    pending={pending && operation === "verify"}
                    pendingLabel={t("checking")}
                  >
                    {t("verify")}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        <section>
          <h3 className="mb-2 font-semibold">{t("pinned")}</h3>
          <ol className="space-y-2">
            {pinned.map((key, index) =>
              row(
                key,
                <>
                  {rowButton(key, index, "up", index === 0)}
                  {rowButton(key, index, "down", index === pinned.length - 1)}
                  {rowButton(key, index, "unpin")}
                </>,
              ),
            )}
          </ol>
          {pinned.length === 0 && <p className="text-muted">{t("empty")}</p>}
        </section>
        <section>
          <h3 className="mb-2 font-semibold">{t("available")}</h3>
          <ul className="space-y-2">
            {unpinned.map((key, index) =>
              row(key, rowButton(key, index, "pin")),
            )}
          </ul>
          {unpinned.length === 0 && (
            <p className="text-muted">{t("noAvailable")}</p>
          )}
        </section>
      </div>
      <div className="grid shrink-0 auto-cols-fr grid-flow-col gap-2 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SheetClose asChild>
          <Button
            ref={cancelButton}
            type="button"
            variant="outline"
            disabled={pending}
          >
            {t("cancel")}
          </Button>
        </SheetClose>
        {(save || (pending && operation === "save")) && (
          <Button
            type="button"
            disabled={!dirty}
            pending={pending}
            pendingLabel={t("saving")}
            onClick={() => void save?.(true)}
          >
            {t("save")}
          </Button>
        )}
      </div>
    </>
  );
}
