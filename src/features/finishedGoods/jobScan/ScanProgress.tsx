"use client";

import { Check, Circle, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  REQUIRED_FIELDS,
  isComplete,
  type TicketDraft,
  type TicketWrite,
} from "./ticketDraft";

/**
 * Identifies the ticket updated by the latest scan and reports required-field
 * progress in the dock once there are tickets to track.
 */
export function ScanProgress({
  tickets,
  written,
  onUndo,
}: {
  tickets: readonly TicketDraft[];
  written: TicketWrite | undefined;
  /** Reverts the latest scan; absent when there is nothing to undo. */
  onUndo?: (() => void) | undefined;
}) {
  const t = useTranslations("JobScan");
  const index = written
    ? tickets.findIndex((ticket) => ticket.key === written.key)
    : -1;
  const ticket = index < 0 ? undefined : tickets[index];
  const incomplete = tickets.filter((row) => !isComplete(row)).length;
  if (!tickets.length) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border py-2 pr-2 pl-3 text-sm">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-w-0 flex-1 space-y-0.5"
      >
        <p className="font-medium wrap-anywhere">
          {ticket && written
            ? t("scanProgressLatest", {
                number: index + 1,
                field: t(written.field),
                code: ticket.values[written.field] ?? "",
              })
            : t("scanProgressWaiting")}
        </p>
        {ticket && (
          <p className="flex flex-wrap gap-x-3">
            {REQUIRED_FIELDS.map((field) => {
              const done = Boolean(ticket.values[field]?.trim());
              const Icon = done ? Check : Circle;
              return (
                <span
                  key={field}
                  className={cn(
                    "flex items-center gap-1",
                    done ? "text-success" : "text-muted",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {t(field)}
                  <span className="sr-only">
                    {t(done ? "scanProgressDone" : "scanProgressMissing")}
                  </span>
                </span>
              );
            })}
          </p>
        )}
        <p className="text-muted">
          {t("scanProgressIncomplete", { count: incomplete })}
        </p>
      </div>
      {ticket && onUndo && (
        <Button
          variant="outline"
          size="sm"
          aria-label={t("undoScan", { number: index + 1 })}
          onClick={onUndo}
        >
          <Undo2 className="size-4" aria-hidden="true" />
          {t("undoScanShort")}
        </Button>
      )}
    </div>
  );
}
