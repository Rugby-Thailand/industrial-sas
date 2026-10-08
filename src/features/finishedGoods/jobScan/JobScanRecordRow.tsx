"use client";

import { useRef } from "react";
import { ImageOff, MapPin, MoreVertical, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useFormatter, useTranslations } from "next-intl";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { IconButton } from "@/components/ui/IconButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { RefValue } from "@/lib/convex/clientRef";
import type { fgRefs } from "@/lib/convex/finishedGoodsApi";
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
}: {
  record: JobScanRecord;
  canManage: boolean;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onChangeLocation: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("JobScan");
  const format = useFormatter();
  const changingLocation = useRef(false);
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
      </div>
      <div className="col-span-3 col-start-2 row-start-2 min-w-0 space-y-2 lg:col-span-1 lg:col-start-4 lg:row-start-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex min-w-0 items-center gap-2">
            <MapPin className="size-5 shrink-0 text-muted" aria-hidden="true" />
            <span className="font-mono font-semibold break-all">
              {record.locationCode ?? record.locationText}
            </span>
          </span>
          <StatusBadge
            tone={record.mapped ? "success" : "warning"}
            label={record.mapped ? t("statusMapped") : t("statusUnmapped")}
            icon={<span className="block size-1.5 rounded-full bg-current" />}
          />
        </div>
        {(record.locationName ||
          (record.mapped && record.locationText !== record.locationCode)) && (
          <p className="hidden pl-7 text-sm text-muted lg:block">
            {record.locationName ?? record.locationText}
          </p>
        )}
        <p className="text-xs text-muted sm:text-sm">
          {format.dateTime(record.createdAt, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          {` · ${t(`source.${record.source}`)}`}
        </p>
      </div>
      {canManage && (
        <div className="col-start-4 row-start-1 flex items-center gap-0.5 lg:col-start-5">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton
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
                  onSelect={() => {
                    changingLocation.current = true;
                    onChangeLocation();
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
