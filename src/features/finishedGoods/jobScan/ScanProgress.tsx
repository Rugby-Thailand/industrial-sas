"use client";

import { Check, Circle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  REQUIRED_FIELDS,
  isComplete,
  type TicketDraft,
  type TicketWrite,
} from "./ticketDraft";

/**
 * Shows which ticket the last scan actually filled; the ticket list sits below
 * the camera. Every row is one fixed-height line so the camera never moves.
 */
export function ScanProgress({
  tickets,
  written,
}: {
  tickets: readonly TicketDraft[];
  written: TicketWrite | undefined;
}) {
  const t = useTranslations("JobScan");
  const index = written
    ? tickets.findIndex((ticket) => ticket.key === written.key)
    : -1;
  const ticket = index < 0 ? undefined : tickets[index];
  const incomplete = tickets.filter((row) => !isComplete(row)).length;
  const row = "h-5 truncate leading-5";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="space-y-0.5 rounded-md border border-border px-3 py-2 text-sm"
    >
      <p className={cn(row, "font-medium")}>
        {ticket && written
          ? t("scanProgressLatest", {
              number: index + 1,
              field: t(written.field),
              code: ticket.values[written.field] ?? "",
            })
          : t("scanProgressWaiting")}
      </p>
      <p className={cn(row, "flex gap-4 whitespace-nowrap")}>
        {ticket &&
          REQUIRED_FIELDS.map((field) => {
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
      <p className={cn(row, "text-muted")}>
        {tickets.length > 0 &&
          t("scanProgressIncomplete", { count: incomplete })}
      </p>
    </div>
  );
}
