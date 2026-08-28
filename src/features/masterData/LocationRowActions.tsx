"use client";

import { useQuery } from "convex/react";
import { MapPinned, PencilLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  StorageViewModeToggle,
  StorageZoneVisualizer,
  type StorageViewMode,
} from "@/components/storageLayouts/StorageZoneVisualizer";
import {
  TableAction,
  TableRowActions,
} from "@/components/table/TableRowControls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TenantOutcome } from "@/lib/convex/ledgerApi";
import type { LocationRow } from "@/lib/convex/masterDataApi";
import {
  storageLayoutRefs,
  type StorageLocationMapDetail,
} from "@/lib/convex/storageLayoutApi";

import { LOCATION_TYPES, type LocationType } from "./CoreForms";

export function LocationRowActions({
  row,
  busy,
  onTypeChange,
}: {
  readonly row: LocationRow;
  readonly busy: boolean;
  readonly onTypeChange: (locationType: LocationType) => void;
}) {
  return (
    <TableRowActions>
      <EditLocationDialog row={row} busy={busy} onTypeChange={onTypeChange} />
      <LocationMapDialog row={row} />
    </TableRowActions>
  );
}

function LocationMapDialog({ row }: { readonly row: LocationRow }) {
  const t = useTranslations("MasterData");
  const [open, setOpen] = useState(false);
  const outcome = useQuery(
    storageLayoutRefs.locationMap,
    open
      ? { warehouseId: row.warehouseId, locationId: row.locationId }
      : "skip",
  ) as TenantOutcome<StorageLocationMapDetail> | undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <TableAction label={t("viewLocationMap", { code: row.code })}>
          <MapPinned aria-hidden="true" className="size-4" />
        </TableAction>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{row.code}</DialogTitle>
        </DialogHeader>
        {outcome === undefined ? (
          <div className="h-80 animate-pulse rounded-xl border border-border bg-raised" />
        ) : !outcome.ok ? (
          <MapMessage
            title={t("locationMapUnavailable")}
            body={t("locationMapUnavailableHelp")}
          />
        ) : !outcome.value.found ? (
          <MapMessage
            title={t("locationNotMapped")}
            body={t("locationNotMappedHelp")}
          />
        ) : (
          <LocationMapPreview detail={outcome.value} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MapMessage({
  title,
  body,
}: {
  readonly title: string;
  readonly body: string;
}) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-background p-8 text-center">
      <div>
        <MapPinned aria-hidden="true" className="mx-auto size-9 text-muted" />
        <p className="mt-3 font-semibold text-text">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted">{body}</p>
      </div>
    </div>
  );
}

function LocationMapPreview({
  detail,
}: {
  readonly detail: Extract<StorageLocationMapDetail, { readonly found: true }>;
}) {
  const t = useTranslations("MasterData");
  const storageT = useTranslations("StorageLayouts");
  const [view, setView] = useState<StorageViewMode>("3d");
  const { building, floor, zone } = detail;
  const widthMm = floor.widthMm ?? building.widthMm;
  const depthMm = floor.depthMm ?? building.depthMm;
  const heightMm = floor.heightMm ?? building.defaultFloorHeightMm;
  const otherZones = floor.storageZones
    .filter((candidate) => candidate.zoneId !== zone.zoneId)
    .map((candidate) => ({
      id: candidate.zoneId,
      label: candidate.code,
      xMm: candidate.xMm,
      yMm: candidate.yMm,
      widthMm: candidate.widthMm,
      depthMm: candidate.depthMm,
    }));
  const reservedBlocks = floor.reservedBlocks.map((block) => ({
    id: block.blockId,
    label: block.label,
    xMm: block.xMm,
    yMm: block.yMm,
    widthMm: block.widthMm,
    depthMm: block.depthMm,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <figure className="overflow-hidden rounded-xl border border-border bg-background">
        <figcaption className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-text">
              {t("locationMapTitle")}
            </p>
            <p className="mt-0.5 text-xs text-muted">{zone.code}</p>
          </div>
          <StorageViewModeToggle
            value={view}
            onChange={setView}
            label={storageT("viewMode")}
            planLabel={storageT("planView")}
            threeDLabel={storageT("threeDView")}
          />
        </figcaption>
        <StorageZoneVisualizer
          mode={view}
          ariaLabel={t(
            view === "3d" ? "locationMap3dGraphic" : "locationMapGraphic",
            { code: zone.code },
          )}
          floorWidthMm={widthMm}
          floorDepthMm={depthMm}
          floorHeightMm={heightMm}
          selection={{
            id: zone.zoneId,
            label: zone.code,
            xMm: zone.xMm,
            yMm: zone.yMm,
            widthMm: zone.widthMm,
            depthMm: zone.depthMm,
            heightMm: zone.maxStackHeightMm,
          }}
          zones={otherZones}
          reservedBlocks={reservedBlocks}
          className="h-[26rem] w-full"
        />
      </figure>
      <dl className="grid content-start gap-4 rounded-xl border border-border bg-surface p-4 text-sm">
        <MapFact
          label={t("mappedBuilding")}
          value={`${building.code} · ${building.name}`}
        />
        <MapFact
          label={t("mappedFloor")}
          value={t("floorNumber", { floor: floor.floorNumber })}
        />
        <MapFact label={t("highlightedLocation")} value={zone.code} />
        <MapFact
          label={t("locationCoordinates")}
          value={`X ${formatMetres(zone.xMm)} m · Y ${formatMetres(zone.yMm)} m`}
        />
        <MapFact
          label={t("locationDimensions")}
          value={`${formatMetres(zone.widthMm)} × ${formatMetres(zone.depthMm)} m`}
        />
      </dl>
    </div>
  );
}

function MapFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-text">{value}</dd>
    </div>
  );
}

function formatMetres(valueMm: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    valueMm / 1000,
  );
}

function EditLocationDialog({
  row,
  busy,
  onTypeChange,
}: {
  readonly row: LocationRow;
  readonly busy: boolean;
  readonly onTypeChange: (locationType: LocationType) => void;
}) {
  const t = useTranslations("MasterData");
  const typeT = useTranslations("LocationType");
  const [open, setOpen] = useState(false);
  const [locationType, setLocationType] = useState(row.locationType);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setLocationType(row.locationType);
      }}
    >
      <DialogTrigger asChild>
        <TableAction
          disabled={busy}
          label={t("editLocation", { code: row.code })}
        >
          <PencilLine aria-hidden="true" className="size-4" />
        </TableAction>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("editLocationTitle", { code: row.code })}
          </DialogTitle>
          <DialogDescription>{t("editLocationDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>{t("columnLocationType")}</Label>
          <Select value={locationType} onValueChange={setLocationType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCATION_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {typeT(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={busy || locationType === row.locationType}
            onClick={() => {
              onTypeChange(locationType as LocationType);
              setOpen(false);
            }}
          >
            {t("saveLocationChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
