"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorNotice } from "@/components/ui/Notice";

/**
 * The shell of a confirmation: a title, what will happen, optional review
 * content, an error from the last attempt, and a cancel/confirm pair.
 *
 * Shared rules: while `pending` the dialog cannot be dismissed (Escape, the
 * overlay and Cancel do nothing) and the confirm action shows its pending
 * label. The caller runs the write, keeps its request identity and retry
 * rules, and closes the dialog itself after success; a failure leaves the
 * dialog open with `error` so the reviewed content is not lost.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  error,
  cancelLabel,
  closeLabel,
  confirmLabel,
  pendingLabel,
  confirmIcon,
  tone = "default",
  pending = false,
  confirmDisabled = false,
  onConfirm,
  size = "sm",
  testId,
}: {
  readonly open: boolean;
  /** Called with `false` for a dismissal; never while pending. */
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Review content between the description and the actions. */
  readonly children?: ReactNode;
  readonly error?: string | null | undefined;
  readonly cancelLabel: string;
  /** Accessible name of the corner close button; omit to show none. */
  readonly closeLabel?: string;
  readonly confirmLabel: ReactNode;
  readonly pendingLabel: ReactNode;
  readonly confirmIcon?: ReactNode;
  readonly tone?: "default" | "destructive";
  readonly pending?: boolean;
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly size?: "sm" | "md";
  readonly testId?: string;
}) {
  const dismiss = (next: boolean) => {
    if (!next && pending) return;
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={dismiss} backPending={pending}>
      <DialogContent
        size={size}
        closeLabel={closeLabel ?? cancelLabel}
        showCloseButton={closeLabel !== undefined && !pending}
        {...(testId === undefined ? {} : { "data-testid": testId })}
      >
        <DialogHeader className={closeLabel === undefined ? "pr-0" : ""}>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        {children}
        <ErrorNotice message={error ?? null} />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => dismiss(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "destructive" ? "destructive" : "default"}
            pending={pending}
            pendingLabel={pendingLabel}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmIcon}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
