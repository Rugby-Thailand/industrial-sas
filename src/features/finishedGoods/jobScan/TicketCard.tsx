"use client";

import { useId } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { FormField } from "@/components/ui/FormField";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { ScanCodeInput } from "@/components/ui/ScanCodeInput";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils";
import { JobScanPhotoPreview } from "./JobScanPhotoPreview";
import {
  DETAIL_FIELDS,
  NUMBER_FIELDS,
  REQUIRED_FIELDS,
  TICKET_CODE_LIMITS,
  hasInvalidQuantity,
  type TicketDraft,
  type TicketField,
  type TicketCodeField,
} from "./ticketDraft";

function TicketInput({
  ticket,
  field,
  onChange,
  onScan,
  disabled,
  large = false,
}: {
  ticket: TicketDraft;
  field: TicketField;
  onChange: (field: TicketField, value: string) => void;
  onScan: (field: TicketCodeField) => void;
  disabled: boolean;
  large?: boolean;
}) {
  const t = useTranslations("JobScan");
  const id = useId();
  const value = ticket.values[field] ?? "";
  const required = (REQUIRED_FIELDS as readonly string[]).includes(field);
  const codeField = required ? (field as TicketCodeField) : undefined;
  const inputProps = {
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      onChange(field, event.target.value),
    disabled: disabled || ticket.status === "reading",
    inputMode: NUMBER_FIELDS.has(field) ? ("decimal" as const) : undefined,
    autoComplete: "off",
    spellCheck: false,
    maxLength: codeField ? TICKET_CODE_LIMITS[codeField] : 200,
    "aria-invalid": required && !value.trim() ? true : undefined,
    className: cn(
      large && "min-h-12 font-mono text-base font-semibold",
      ticket.aiFields.includes(field) && "border-warning bg-warning-surface",
    ),
  };
  return (
    <FormField
      id={id}
      label={t(field)}
      required={required}
      className="gap-1"
      labelClassName="text-xs text-muted"
    >
      {(control) =>
        codeField ? (
          <ScanCodeInput
            {...control}
            {...inputProps}
            scanDialog
            scanLabel={t("scanField", { field: t(field) })}
            onScan={() => onScan(codeField)}
          />
        ) : (
          <Input {...control} {...inputProps} />
        )
      }
    </FormField>
  );
}

export function TicketCard({
  ticket,
  index,
  onChange,
  onRemove,
  onScan,
  disabled = false,
  duplicate = false,
}: {
  ticket: TicketDraft;
  index: number;
  onChange: (field: TicketField, value: string) => void;
  onRemove: () => void;
  onScan: (field: TicketCodeField) => void;
  disabled?: boolean;
  duplicate?: boolean;
}) {
  const t = useTranslations("JobScan");
  const filled = DETAIL_FIELDS.filter((field) =>
    ticket.values[field]?.trim(),
  ).length;
  const image = ticket.imageUrl ?? ticket.previewUrl;
  return (
    <li className="space-y-3 border-b border-border py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-muted">#{index + 1}</span>
        <StatusBadge tone="muted" label={t(`source.${ticket.source}`)} />
        {ticket.status === "reading" && (
          <span className="flex items-center gap-1 text-sm text-pending">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t("reading")}
          </span>
        )}
        <IconButton
          variant="ghost"
          className="ml-auto"
          label={`${t("remove")} #${index + 1}`}
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      {duplicate && (
        <p className="text-sm text-warning">{t("duplicateTickets")}</p>
      )}
      {hasInvalidQuantity(ticket) && (
        <p role="alert" className="text-sm text-danger">
          {t("invalidQuantity")}
        </p>
      )}
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
      <div className="flex flex-col gap-3 sm:flex-row">
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
              onScan={onScan}
              disabled={disabled}
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
            onScan={onScan}
            disabled={disabled}
          />
        ))}
      </CollapsibleSection>
    </li>
  );
}
