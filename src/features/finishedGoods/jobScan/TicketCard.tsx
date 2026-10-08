"use client";

import { useId } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils";
import { JobScanPhotoPreview } from "./JobScanPhotoPreview";
import {
  DETAIL_FIELDS,
  NUMBER_FIELDS,
  REQUIRED_FIELDS,
  type TicketDraft,
  type TicketField,
} from "./ticketDraft";

function TicketInput({
  ticket,
  field,
  onChange,
  large = false,
}: {
  ticket: TicketDraft;
  field: TicketField;
  onChange: (field: TicketField, value: string) => void;
  large?: boolean;
}) {
  const t = useTranslations("JobScan");
  const id = useId();
  const value = ticket.values[field] ?? "";
  const required = (REQUIRED_FIELDS as readonly string[]).includes(field);
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs text-muted">
        {t(field)}
        {required && <span className="text-danger"> *</span>}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(field, event.target.value)}
        disabled={ticket.status === "reading"}
        inputMode={NUMBER_FIELDS.has(field) ? "decimal" : undefined}
        autoComplete="off"
        spellCheck={false}
        maxLength={200}
        aria-invalid={required && !value.trim() ? true : undefined}
        className={cn(
          large && "min-h-12 font-mono text-base font-semibold",
          ticket.aiFields.includes(field) &&
            "border-warning bg-warning-surface",
        )}
      />
    </div>
  );
}

export function TicketCard({
  ticket,
  index,
  onChange,
  onRemove,
}: {
  ticket: TicketDraft;
  index: number;
  onChange: (field: TicketField, value: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("JobScan");
  const filled = DETAIL_FIELDS.filter((field) =>
    ticket.values[field]?.trim(),
  ).length;
  const image = ticket.imageUrl ?? ticket.previewUrl;
  return (
    <li className="space-y-3 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-muted">#{index + 1}</span>
        <StatusBadge tone="muted" label={t(`source.${ticket.source}`)} />
        {ticket.status === "reading" && (
          <span className="flex items-center gap-1 text-sm text-pending">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t("reading")}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          className="ml-auto size-10"
          aria-label={`${t("remove")} #${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {ticket.notice && (
        <p
          className={cn(
            "rounded-md px-2 py-1 text-xs",
            ticket.notice === "aiFilled" || ticket.notice === "aiMock"
              ? "bg-warning-surface text-warning"
              : "bg-danger-surface text-danger",
          )}
        >
          {t(ticket.notice)}
        </p>
      )}
      <div className="flex gap-3">
        {image && (
          <JobScanPhotoPreview
            src={image}
            thumbnailClassName="h-28 w-20 rounded-md border border-border object-cover"
          />
        )}
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
          {REQUIRED_FIELDS.map((field) => (
            <TicketInput
              key={field}
              ticket={ticket}
              field={field}
              onChange={onChange}
              large
            />
          ))}
        </div>
      </div>
      <CollapsibleSection
        label={t("moreDetails")}
        badge={t("filledCount", { count: filled })}
        contentClassName="grid gap-2 sm:grid-cols-2"
      >
        {DETAIL_FIELDS.map((field) => (
          <TicketInput
            key={field}
            ticket={ticket}
            field={field}
            onChange={onChange}
          />
        ))}
      </CollapsibleSection>
    </li>
  );
}
