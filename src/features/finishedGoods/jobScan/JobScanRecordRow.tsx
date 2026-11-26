"use client";

import { useRef } from "react";
import {
  ImageOff,
  MapPin,
  MoreVertical,
  Trash2,
  Pencil,
  Sparkles,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useFormatter, useTranslations } from "next-intl";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { IconButton } from "@/components/ui/IconButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Link } from "@/i18n/navigation";
import { customerPath } from "@/lib/navigation";
import type { RefValue } from "@/lib/convex/clientRef";
import type { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { cn } from "@/lib/utils";
import { JobScanPhotoPreview } from "./JobScanPhotoPreview";

type JobScanRecord = RefValue<typeof fgRefs.listJobScans>["items"][number];

export function JobScanRecordRow({
  record,
  canManage,
  selected,
  disabled,
  onToggle,
  onChangeLocation,
  onDelete,
  onEdit,
  onAssist,
}: {
  record: JobScanRecord;
  canManage: boolean;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onChangeLocation: (opener?: HTMLElement | null) => void;
  onDelete: () => void;
  onEdit: () => void;
  onAssist?: () => void;
}) {
  const t = useTranslations("JobScan");
  const format = useFormatter();
  const changingLocation = useRef(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const locationCode = record.locationCode ?? record.locationText;
  // A distinct name or original label adds information; an equal one repeats the code.
  const locationName =
    record.locationName || (record.mapped ? record.locationText : undefined);
  const locationActionLabel = record.mapped
    ? t("changeLocationRecord", { job: record.factoryOrder })
    : t("setLocationRecord", { job: record.factoryOrder });
  return (
    <li className="grid grid-cols-[1.5rem_2.75rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 py-3 sm:grid-cols-[1.5rem_3.5rem_minmax(0,1fr)_auto] sm:gap-x-3 lg:grid-cols-[1.5rem_3.5rem_minmax(0,1fr)_17rem_auto]">
      {canManage && (
        <label className="col-start-1 row-start-1 -mx-3 flex min-h-touch min-w-touch cursor-pointer items-start justify-center pt-2">
          <CheckboxControl
            className="size-6 accent-primary"
            aria-label={`${t("select")} ${record.factoryOrder}`}
            checked={selected}
            disabled={disabled}
            onChange={onToggle}
          />
        </label>
      )}
      <div className="col-start-2 row-start-1">
        {record.imageUrl ? (
          <JobScanPhotoPreview
            src={record.imageUrl}
            thumbnailClassName="h-16 w-11 rounded-lg object-cover sm:h-20 sm:w-14"
          />
        ) : (
          <div
            className="flex h-16 w-11 items-center justify-center rounded-lg bg-linear-to-br from-border-strong/50 via-border-strong/30 to-raised sm:h-20 sm:w-14"
            aria-label={t("noPhoto")}
            role="img"
          >
            <ImageOff className="size-5 text-muted/60" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="col-start-3 row-start-1 min-w-0 space-y-1.5">
        <p className="font-mono text-base font-semibold break-all">
          {record.factoryOrder}
        </p>
        <p className="text-xs break-all text-muted sm:text-sm">
          {record.productBarcodeText}
        </p>
        {(record.partName || record.quantity !== undefined) && (
          <p
            className="truncate text-xs text-muted sm:text-sm"
            title={[
              record.partName,
              record.quantity !== undefined
                ? format.number(record.quantity)
                : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            {record.partName}
            {record.quantity !== undefined &&
              ` · ${format.number(record.quantity)}`}
          </p>
        )}
        {record.customerId && record.customerName ? (
          <p className="truncate text-xs sm:text-sm">
            <Link
              href={customerPath(record.customerId)}
              className="text-link hover:underline"
            >
              {record.customerName}
              {record.customerCode ? ` (${record.customerCode})` : null}
            </Link>
          </p>
        ) : record.customer ? (
          <p className="truncate text-xs text-muted sm:text-sm">
            {record.customer}
          </p>
        ) : null}
      </div>
      <div className="col-span-3 col-start-2 row-start-2 min-w-0 space-y-1.5 lg:col-span-1 lg:col-start-4 lg:row-start-1">
        <div
          className={
            canManage
              ? "grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg bg-raised py-1.5 pr-1 pl-2.5"
              : "grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-2 rounded-lg bg-raised px-2.5 py-1.5"
          }
        >
          <MapPin className="size-4 shrink-0 text-link" aria-hidden="true" />
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {locationCode && (
                <span className="font-mono text-sm font-semibold break-all">
                  {locationCode}
                </span>
              )}
              <StatusBadge
                tone={record.mapped ? "success" : "warning"}
                label={record.mapped ? t("statusMapped") : t("statusUnmapped")}
                icon={
                  <span className="block size-1.5 rounded-full bg-current" />
                }
              />
            </div>
            {locationName && locationName !== locationCode && (
              <p className="hidden text-xs text-muted lg:block">
                {locationName}
              </p>
            )}
            {record.buildingName && (
              <p className="text-xs text-muted">
                {record.buildingName}
                {record.floorNumber === undefined
                  ? ""
                  : ` · ${t("floorNumber", { number: record.floorNumber })}`}
              </p>
            )}
            {record.storageFormat && (
              <p className="text-xs text-muted">
                {t(`format.${record.storageFormat}`)}
              </p>
            )}
          </div>
          {canManage && (
            <IconButton
              variant="ghost"
              aria-haspopup="dialog"
              className="text-link hover:bg-accent-surface"
              label={locationActionLabel}
              disabled={disabled}
              onClick={(event) => onChangeLocation(event.currentTarget)}
            >
              <Pencil aria-hidden="true" className="size-4" />
            </IconButton>
          )}
        </div>
        <p className="text-xs text-muted sm:text-sm">
          {format.dateTime(record.createdAt, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          {` · ${t(`source.${record.source}`)}`}
        </p>
      </div>
      {canManage && (
        <div
          className={cn(
            "col-start-4 row-start-1 flex items-center gap-0.5 lg:col-start-5",
            onAssist && "max-[400px]:grid max-[400px]:grid-cols-2",
          )}
        >
          {onAssist && (
            <IconButton
              variant="ghost"
              aria-haspopup="dialog"
              className="text-link hover:bg-accent-surface max-[400px]:col-start-2 max-[400px]:row-start-2"
              label={t("recordTools.aiEditRecord", {
                job: record.factoryOrder,
              })}
              disabled={disabled}
              onClick={onAssist}
            >
              <Sparkles aria-hidden="true" className="size-5" />
            </IconButton>
          )}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton
                ref={menuTrigger}
                variant="ghost"
                className="text-muted"
                label={t("recordActions", {
                  job: record.factoryOrder,
                })}
                disabled={disabled}
              >
                <MoreVertical aria-hidden="true" className="size-5" />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                onCloseAutoFocus={(event) => {
                  if (changingLocation.current) {
                    event.preventDefault();
                    changingLocation.current = false;
                  }
                }}
                className="z-50 min-w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              >
                <DropdownMenu.Item
                  onSelect={onEdit}
                  className="flex min-h-touch cursor-pointer items-center gap-2 rounded-md px-3 text-sm outline-none data-highlighted:bg-raised"
                >
                  <Pencil aria-hidden="true" className="size-4" />
                  {t("editRecord")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => {
                    changingLocation.current = true;
                    onChangeLocation(menuTrigger.current);
                  }}
                  className="flex min-h-touch cursor-pointer items-center gap-2 rounded-md px-3 text-sm outline-none data-highlighted:bg-raised"
                >
                  <MapPin aria-hidden="true" className="size-4" />
                  {t("changeLocation")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <IconButton
            variant="ghost"
            className="text-danger hover:bg-danger-surface"
            label={t("deleteRecord", {
              job: record.factoryOrder,
            })}
            disabled={disabled}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" className="size-5" />
          </IconButton>
        </div>
      )}
    </li>
  );
}
