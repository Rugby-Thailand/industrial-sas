"use client";
import { updateBrowserQuery } from "@/lib/browser/history";
import {
  ChangeImpactSummary,
  localEntityId,
  metres,
  Metric,
  millimetres,
  squareMetres,
  storageErrorMessage,
} from "./storageLayoutShared";
import { StorageZonesPanel } from "./StorageZonesPanel";
import type { EditableBlock } from "./types";
import { useFloorSelection } from "./useFloorSelection";
import { useWorkspaceQuery, workspaceStateEvent } from "./useWorkspaceQuery";
export { StorageZoneDraftPreview } from "@/components/storageLayouts/StorageZoneDraftPreview";
export { StorageZonesPanel } from "./StorageZonesPanel";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { AreaColorPicker } from "@/components/storageLayouts/AreaColorPicker";
import { StorageZoneDraftPreview } from "@/components/storageLayouts/StorageZoneDraftPreview";
import {
  ReservedAreaLegend,
  ReservedAreaShape,
  StorageViewModeToggle,
} from "@/components/storageLayouts/StorageZoneVisualizer";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import { resolveAreaColor } from "@/lib/storageLayouts/areaColors";
import { storageFootprintUsage } from "../../../convex/model/storageLayout/areaUsage";
import { isStorageFloorColorOnlyChange } from "../../../convex/model/storageLayout/storageLayout";
import { AreaOverview } from "./AreaOverview";
import { BuildingAreaDetails } from "./BuildingAreaDetails";
import { BuildingStatusToggle } from "./BuildingStatusToggle";
import { useWorkspaceNavigationGuard } from "./useWorkspaceNavigationGuard";

import { CursorPagination } from "@/components/system/CursorPagination";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import {
  useDebouncedSearch,
  useScanContinuation,
} from "@/hooks/useScanContinuation";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import {
  Layers3,
  PencilLine,
  Plus,
  Ruler,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from "react";

import { FloorMap } from "@/components/storageLayouts/FloorMap";
import {
  Fg1ReferencePreview,
  matchesFg1Reference,
} from "@/components/storageLayouts/Fg1ReferencePreview";
import { StoragePlacementLayer } from "@/components/storageLayouts/StorageZoneVisualizer";
import { QueryGate } from "@/components/system/QueryGate";
import { DataTable } from "@/components/table/DataTable";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/Notice";
import { SelectControl } from "@/components/ui/SelectControl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  storageLayoutRefs,
  type StorageBuildingDetail,
  type StorageBuildingRow,
  type StorageFloorRow,
  type StorageLayoutStatus,
  type StorageStackPlacementRow,
  type StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";
import {
  ROUTES,
  storageBuildingPath,
  storageFloorPath,
} from "@/lib/navigation";
import {
  buildIsometricBuilding,
  pointsAttribute,
  projectIsometricPoint,
  unprojectIsometricDelta,
} from "@/lib/storageLayouts/isometricGeometry";
import { locationInventory } from "@/lib/storageLayouts/locationSelectors";

import { useCanManage } from "@/hooks/useCanManage";
import {
  storagePlacementBoxes,
  storagePlacementCorners,
} from "@/lib/storageLayouts/storagePlacementGeometry";

import {
  StorageLocationCatalogue,
  type CatalogueFilters,
} from "./StorageLocationCatalogue";

function statusLabel(
  t: ReturnType<typeof useTranslations<"StorageLayouts">>,
  status: StorageLayoutStatus,
) {
  return status === "DRAFT"
    ? t("draft")
    : status === "ACTIVE"
      ? t("active")
      : t("archived");
}

function LoadingCard() {
  return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
}

function QueryFailure() {
  const t = useTranslations("StorageLayouts");
  return <Notice tone="warning" title={t("loadError")} />;
}

export function StorageBuildingCatalogue() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <StorageLocationCatalogue key={warehouseId} warehouseId={warehouseId}>
          {(filters) => (
            <CatalogueContent warehouseId={warehouseId} {...filters} />
          )}
        </StorageLocationCatalogue>
      )}
    </QueryGate>
  );
}

function CatalogueContent({
  warehouseId,
  search,
  status,
  onSearchChange,
  onStatusChange,
}: { readonly warehouseId: string } & CatalogueFilters) {
  const t = useTranslations("StorageLayouts");
  const locale = useLocale();
  const { userId, orgId } = useAuth();
  const settled = useDebouncedSearch(search);
  const criteria = { warehouseId, search: settled, status };
  const paging = useCursorPagination({
    scope: `buildings:${orgId}:${userId}:${warehouseId}`,
    criteria,
  });
  const scan = useScanContinuation(
    JSON.stringify([criteria, paging.cursor, paging.pageSize]),
  );
  const outcome = useQuery(
    storageLayoutRefs.page,
    search === settled
      ? {
          warehouseId,
          search: settled,
          ...(status !== "ALL" ? { status } : {}),
          pageSize: paging.pageSize,
          ...(paging.cursor ? { cursor: paging.cursor } : {}),
          ...(scan.cursor ? { scanCursor: scan.cursor } : {}),
        }
      : "skip",
  );
  const resetScope = JSON.stringify(criteria);
  useCatalogueSync({
    outcome,
    continuation: scan,
    paging,
    resetKey: resetScope,
    hasRows: (value) => Boolean(value.page?.length),
  });
  const ready = outcome?.ok && outcome.value.status === "ready";
  const buildings = ready ? outcome.value.page : [];
  return (
    <div className="space-y-4">
      <StorageCatalogueFilters
        search={search}
        status={status}
        onSearchChange={onSearchChange}
        onStatusChange={onStatusChange}
      />
      {outcome && (!outcome.ok || outcome.value.status === "reset") ? (
        <QueryFailure />
      ) : !ready ? (
        <LoadingCard />
      ) : buildings.length === 0 ? (
        <EmptyState title={t("noMatches")} body={t("noMatchesBody")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {buildings.map((building) => (
            <article
              key={building.buildingId}
              className="group relative rounded-xl border border-border bg-surface p-4 transition-colors hover:border-ring"
            >
              <div className="flex items-start justify-between gap-4">
                <CompactBuildingModel building={building} />
                <BuildingStatusToggle
                  warehouseId={warehouseId}
                  buildingId={building.buildingId}
                  code={building.code}
                  status={building.status}
                />
              </div>
              <p className="mt-5 text-xs font-semibold tracking-[0.16em] text-muted uppercase">
                {building.code}
              </p>
              <h2 className="mt-1 text-lg leading-7 font-semibold break-words text-text group-hover:text-link">
                <Link
                  href={storageBuildingPath(building.buildingId)}
                  className="after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-accent"
                >
                  {building.name}
                </Link>
              </h2>
              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
                <Metric
                  label={t("floors")}
                  value={String(building.floorCount)}
                />
                <Metric
                  label={t("dimensions")}
                  value={`${metres(building.widthMm)} × ${metres(building.depthMm)} m`}
                />
              </dl>
              <div className="mt-4">
                <BuildingCatalogueOccupancy building={building} />
              </div>
            </article>
          ))}
        </div>
      )}
      <CursorPagination
        page={paging.page}
        pageSize={paging.pageSize}
        onPageSizeChange={paging.setPageSize}
        onPrevious={paging.previous}
        onNext={() => {
          if (ready) paging.next(outcome.value.continueCursor);
        }}
        canPrevious={paging.canPrevious}
        canNext={Boolean(ready && !outcome.value.isDone)}
        loading={!ready}
        locale={locale === "th" ? "th" : "en"}
      />
      <Notice
        tone="muted"
        title={t("planningNotice")}
        body={t("planningNoticeBody")}
      />
    </div>
  );
}

function BuildingCatalogueOccupancy({
  building,
}: {
  building: StorageBuildingRow;
}) {
  const outcome = useQuery(storageLayoutRefs.occupancy, {
    warehouseId: building.warehouseId,
    buildingId: building.buildingId,
  });
  if (!outcome) return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok || !outcome.value)
    return (
      <LedgerPanelStatus
        state={{ kind: "ERROR", code: "OCCUPANCY_UNAVAILABLE" }}
      />
    );
  return <BuildingAreaDetails building={outcome.value} />;
}

export function StorageCatalogueFilters({
  search,
  status,
  onSearchChange,
  onStatusChange,
}: {
  readonly search: string;
  readonly status: StorageLayoutStatus | "ALL";
  readonly onSearchChange: (value: string) => void;
  readonly onStatusChange: (value: StorageLayoutStatus | "ALL") => void;
}) {
  const t = useTranslations("StorageLayouts");

  return (
    <div
      data-testid="storage-catalogue-filters"
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]"
    >
      <label className="relative min-w-0">
        <span className="sr-only">{t("search")}</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("search")}
          className="pl-10"
        />
      </label>
      <SelectControl
        value={status}
        onValueChange={(value) =>
          onStatusChange(value as StorageLayoutStatus | "ALL")
        }
        options={[
          { value: "ALL", label: t("allStatuses") },
          { value: "DRAFT", label: t("draft") },
          { value: "ACTIVE", label: t("active") },
          { value: "ARCHIVED", label: t("archived") },
        ]}
        placeholder={t("statusFilter")}
        emptyLabel={t("allStatuses")}
        label={t("statusFilter")}
      />
    </div>
  );
}

function CompactBuildingModel({
  building,
}: {
  readonly building: StorageBuildingRow;
}) {
  const geometry = buildIsometricBuilding(
    Array.from({ length: building.floorCount }, (_, index) => ({
      floorNumber: index + 1,
      widthMm: building.widthMm,
      depthMm: building.depthMm,
      heightMm: building.defaultFloorHeightMm,
    })),
    { scale: 0.006, gap: 4 },
  );
  return (
    <svg
      aria-hidden="true"
      viewBox={`${geometry.viewBox.x} ${geometry.viewBox.y} ${geometry.viewBox.width} ${geometry.viewBox.height}`}
      className="h-24 w-32 shrink-0 overflow-visible"
    >
      {[...geometry.slabs].reverse().map((slab, index) => (
        <g key={slab.floorNumber}>
          <polygon
            points={pointsAttribute(slab.left)}
            className="fill-accent/15 stroke-accent/45"
          />
          <polygon
            points={pointsAttribute(slab.right)}
            className="fill-accent/25 stroke-accent/55"
          />
          <polygon
            points={pointsAttribute(slab.top)}
            className={
              index === 0
                ? "fill-accent/35 stroke-accent"
                : "fill-surface/80 stroke-accent/60"
            }
          />
        </g>
      ))}
    </svg>
  );
}

export function NewStorageBuildingForm() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => <NewBuildingContent warehouseId={warehouseId} />}
    </QueryGate>
  );
}

function NewBuildingContent({ warehouseId }: { readonly warehouseId: string }) {
  const t = useTranslations("StorageLayouts");
  const router = useRouter();
  const create = useMutation(storageLayoutRefs.create);
  const operation = useAsyncOperation({
    scope: `new-building:${warehouseId}`,
    describeError: (code) => code || "UNKNOWN",
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      warehouseId,
      code: String(data.get("code") ?? ""),
      name: String(data.get("name") ?? ""),
      widthMm: millimetres(String(data.get("width") ?? "")),
      depthMm: millimetres(String(data.get("depth") ?? "")),
      defaultFloorHeightMm: millimetres(String(data.get("height") ?? "")),
      floorCount: Number(data.get("floors")),
    };
    await operation.run(async () => {
      const outcome = await create({
        ...payload,
        requestId: operation.request(JSON.stringify(payload)),
      });
      if (!outcome.ok) operation.setError(outcome.denial.code);
      else if (!outcome.value.written)
        operation.setError(outcome.value.error.code);
      else {
        operation.clearRequests();
        router.push(storageBuildingPath(outcome.value.documentId));
      }
    });
  }
  return (
    <form
      onSubmit={submit}
      className="grid max-w-3xl gap-6 rounded-lg border border-border bg-surface p-4 sm:p-6"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("code")} name="code" defaultValue="BLDG-A" required />
        <Field
          label={t("name")}
          name="name"
          defaultValue="Main storage"
          required
        />
        <Field
          label={t("width")}
          name="width"
          type="number"
          defaultValue="30"
          min="0.1"
          step="0.1"
          required
        />
        <Field
          label={t("depth")}
          name="depth"
          type="number"
          defaultValue="20"
          min="0.1"
          step="0.1"
          required
        />
        <Field
          label={t("height")}
          name="height"
          type="number"
          defaultValue="4"
          min="0.1"
          step="0.1"
          required
        />
        <Field
          label={t("floors")}
          name="floors"
          type="number"
          defaultValue="4"
          min="1"
          max="50"
          required
        />
        {!operation.error ? null : (
          <div className="sm:col-span-2">
            <Notice
              tone="warning"
              title={storageErrorMessage(t, operation.error)}
            />
          </div>
        )}
        <div className="flex gap-3 sm:col-span-2">
          <Button disabled={operation.busy}>
            {operation.busy ? t("creating") : t("create")}
          </Button>
          <Button variant="outline" asChild>
            <Link href={ROUTES.storageLayouts}>{t("back")}</Link>
          </Button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  hint,
  error,
  ...props
}: {
  readonly label: string;
  readonly name: string;
  readonly hint?: string;
  readonly error?: string;
} & React.ComponentProps<typeof Input>) {
  return (
    <FormField
      id={name}
      label={label}
      required={props.required ?? false}
      hint={hint}
      error={error}
    >
      {(field) => <Input {...field} name={name} {...props} />}
    </FormField>
  );
}

function useBuilding(warehouseId: string, buildingId: string) {
  return useQuery(storageLayoutRefs.get, { warehouseId, buildingId });
}

export function StorageBuildingEditor({
  buildingId,
}: {
  readonly buildingId: string;
}) {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <BuildingContent warehouseId={warehouseId} buildingId={buildingId} />
      )}
    </QueryGate>
  );
}

function BuildingContent({
  warehouseId,
  buildingId,
}: {
  readonly warehouseId: string;
  readonly buildingId: string;
}) {
  const t = useTranslations("StorageLayouts");
  const outcome = useBuilding(warehouseId, buildingId);
  if (outcome === undefined) return <LoadingCard />;
  if (!outcome.ok) return <QueryFailure />;
  if (!outcome.value.found)
    return <Notice tone="warning" title={t("notFound")} />;
  const { building: savedBuilding, floors } = outcome.value;
  const unmeasuredPalletCount = floors.reduce(
    (sum, floor) =>
      sum +
      floor.storageZones.reduce(
        (count, zone) => count + (zone.unmeasuredPalletCount ?? 0),
        0,
      ),
    0,
  );
  const building = {
    ...savedBuilding,
    unmeasuredPalletCount,
    measuredAreaPartial: unmeasuredPalletCount > 0,
  };
  const placements = floors.flatMap((floor) =>
    floor.storageZones.flatMap((zone) => zone.placements),
  );
  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <BuildingModelWorkspace
          building={building}
          floors={floors}
          statusAction={
            <BuildingStatusToggle
              warehouseId={warehouseId}
              buildingId={buildingId}
              code={building.code}
              status={building.status}
            />
          }
          settingsAction={
            building.status !== "ARCHIVED" ? (
              <BuildingSettingsDialog
                warehouseId={warehouseId}
                building={building}
                placements={placements}
              />
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

export function BuildingSettingsDialog({
  warehouseId,
  building,
  placements = [],
}: {
  readonly warehouseId: string;
  readonly building: StorageBuildingRow;
  readonly placements?: readonly StorageStackPlacementRow[];
}) {
  const t = useTranslations("StorageLayouts");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={t("openSettings")}
          title={t("openSettings")}
          className="bg-surface/90 shadow-sm backdrop-blur-sm"
        >
          <Plus className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent
        closeLabel={t("closeSettings")}
        className="max-w-3xl gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b border-border px-6 py-5 pr-16">
          <DialogTitle>{t("dimensions")}</DialogTitle>
          <DialogDescription>{t("settingsDescription")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(100dvh-10rem)] overflow-y-auto p-6">
          <BuildingSettings
            warehouseId={warehouseId}
            building={building}
            placements={placements}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BuildingSettings({
  warehouseId,
  building,
  placements,
}: {
  readonly warehouseId: string;
  readonly building: StorageBuildingRow;
  readonly placements: readonly StorageStackPlacementRow[];
}) {
  const t = useTranslations("StorageLayouts");
  const update = useMutation(storageLayoutRefs.update);
  const changeFloorCount = useMutation(storageLayoutRefs.changeFloorCount);
  const operation = useAsyncOperation({
    scope: `building-settings:${warehouseId}:${building.buildingId}`,
    describeError: (code) => code || "NETWORK_ERROR",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmingImpact, setConfirmingImpact] = useState(false);
  const [floorHeightChanged, setFloorHeightChanged] = useState(false);

  async function saveDimensions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const heightChanged =
      millimetres(String(data.get("height"))) !== building.defaultFloorHeightMm;
    if (
      placements.length + (building.unmeasuredPalletCount ?? 0) > 0 &&
      heightChanged
    ) {
      setConfirmingImpact(true);
      setError(undefined);
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const payload = {
        warehouseId,
        buildingId: building.buildingId,
        expectedVersion: building.version,
        name: String(data.get("name") ?? building.name),
        widthMm: millimetres(String(data.get("width"))),
        depthMm: millimetres(String(data.get("depth"))),
        defaultFloorHeightMm: millimetres(String(data.get("height"))),
      };
      const result = await operation.run(() =>
        update({
          ...payload,
          requestId: operation.request(JSON.stringify(payload)),
        }),
      );
      if (!result) return;
      if (!result.ok) setError(result.denial.code);
      else if (!result.value.written) setError(result.value.error.code);
      else {
        operation.clearRequests();
        setConfirmingImpact(false);
      }
    } finally {
      setPending(false);
    }
  }

  async function addFloors(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const payload = {
        warehouseId,
        buildingId: building.buildingId,
        expectedVersion: building.version,
        floorCount: Number(data.get("floorCount")),
      };
      const result = await operation.run(() =>
        changeFloorCount({
          ...payload,
          requestId: operation.request(JSON.stringify(payload)),
        }),
      );
      if (!result) return;
      if (!result.ok) setError(result.denial.code);
      else if (!result.value.written) setError(result.value.error.code);
      else operation.clearRequests();
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <form
        onSubmit={saveDimensions}
        onChange={(event) => {
          setConfirmingImpact(false);
          const data = new FormData(event.currentTarget);
          setFloorHeightChanged(
            millimetres(String(data.get("height"))) !==
              building.defaultFloorHeightMm,
          );
        }}
        className="grid gap-4"
      >
        <Field label={t("name")} name="name" defaultValue={building.name} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label={t("width")}
            name="width"
            type="number"
            min="0.1"
            step="0.1"
            defaultValue={metres(building.widthMm)}
          />
          <Field
            label={t("depth")}
            name="depth"
            type="number"
            min="0.1"
            step="0.1"
            defaultValue={metres(building.depthMm)}
          />
          <Field
            label={t("height")}
            name="height"
            type="number"
            min="0.1"
            step="0.1"
            defaultValue={metres(building.defaultFloorHeightMm)}
          />
        </div>
        {confirmingImpact ? (
          <ChangeImpactSummary placements={placements} />
        ) : null}
        {confirmingImpact ? (
          <Button
            type="button"
            size="default"
            variant="outline"
            disabled={pending}
            onClick={() => setConfirmingImpact(false)}
          >
            {t("backToEdit")}
          </Button>
        ) : null}
        <Button
          size="default"
          disabled={
            pending ||
            (confirmingImpact &&
              placements.length + (building.unmeasuredPalletCount ?? 0) > 0)
          }
        >
          {pending
            ? t("saving")
            : confirmingImpact
              ? t("confirmChanges")
              : floorHeightChanged &&
                  placements.length + (building.unmeasuredPalletCount ?? 0) > 0
                ? t("reviewImpact")
                : t("saveBuilding")}
        </Button>
      </form>
      <form
        onSubmit={addFloors}
        className="mt-4 flex items-end gap-2 border-t border-border pt-4"
      >
        <div className="min-w-0 flex-1">
          <Field
            label={t("floors")}
            name="floorCount"
            type="number"
            min={building.floorCount + 1}
            max="50"
            defaultValue={building.floorCount + 1}
          />
        </div>
        <Button size="default" variant="outline" disabled={pending}>
          {t("addFloors")}
        </Button>
      </form>
      {error === undefined ? null : (
        <div className="mt-3">
          <Notice tone="warning" title={storageErrorMessage(t, error)} />
        </div>
      )}
    </div>
  );
}

export function IsometricBuilding({
  building,
  floors,
  highlightedFloorNumber,
  action,
}: {
  readonly building: StorageBuildingRow;
  readonly floors: readonly StorageFloorRow[];
  readonly highlightedFloorNumber?: number;
  readonly action?: ReactNode;
}) {
  const t = useTranslations("StorageLayouts");
  const geometry = useMemo(
    () =>
      buildIsometricBuilding(
        floors.map((floor) => ({
          floorNumber: floor.floorNumber,
          widthMm: floor.widthMm ?? building.widthMm,
          depthMm: floor.depthMm ?? building.depthMm,
          heightMm: floor.heightMm ?? building.defaultFloorHeightMm,
          ...(floor.offsetXMm === undefined
            ? {}
            : { offsetXMm: floor.offsetXMm }),
          ...(floor.offsetYMm === undefined
            ? {}
            : { offsetYMm: floor.offsetYMm }),
        })),
        { scale: 0.012, gap: 0 },
      ),
    [building, floors],
  );
  const topSlab = geometry.slabs.at(-1);
  return (
    <figure className="relative overflow-hidden rounded-2xl border border-border bg-[linear-gradient(145deg,var(--color-surface),var(--color-background))] p-5 shadow-sm">
      <figcaption className="absolute top-5 left-5 z-10 text-sm font-semibold text-muted">
        {t("modelLabel")}
      </figcaption>
      {action === undefined ? null : (
        <div className="absolute top-4 right-4 z-10">{action}</div>
      )}
      <svg
        role="img"
        aria-label={t("modelLabel")}
        viewBox={`${geometry.viewBox.x} ${geometry.viewBox.y} ${geometry.viewBox.width} ${geometry.viewBox.height}`}
        className="h-[26rem] w-full"
      >
        <defs>
          <pattern
            id="storage-model-grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 24 0 L 0 0 0 24"
              className="fill-none stroke-border/35"
              strokeWidth="0.75"
            />
          </pattern>
        </defs>
        <rect
          x={geometry.viewBox.x}
          y={geometry.viewBox.y}
          width={geometry.viewBox.width}
          height={geometry.viewBox.height}
          fill="url(#storage-model-grid)"
          opacity="0.35"
        />
        <g>
          {geometry.slabs.map((slab) => (
            <g
              key={slab.floorNumber}
              className="transition-opacity hover:opacity-80"
            >
              <polygon
                points={pointsAttribute(slab.left)}
                className="fill-accent/20 stroke-accent/55"
              />
              <polygon
                points={pointsAttribute(slab.right)}
                className="fill-accent/30 stroke-accent/60"
              />
              <polygon
                points={pointsAttribute(slab.top)}
                className={
                  highlightedFloorNumber === slab.floorNumber
                    ? "fill-accent/50 stroke-accent"
                    : "fill-surface stroke-accent/65"
                }
                strokeWidth={
                  highlightedFloorNumber === slab.floorNumber ? 2.5 : 1
                }
              />
              <text
                x={slab.top[0]!.x + 12}
                y={slab.top[0]!.y - 8}
                className="fill-muted text-[12px]"
              >
                {slab.floorNumber}
              </text>
            </g>
          ))}
          {topSlab === undefined ? null : (
            <>
              <line
                x1={topSlab.top[1]!.x + 18}
                y1={topSlab.top[1]!.y}
                x2={topSlab.top[1]!.x + 18}
                y2={geometry.viewBox.y + geometry.viewBox.height - 20}
                className="stroke-muted"
                strokeDasharray="5 5"
              />
              <text
                x={topSlab.top[1]!.x + 26}
                y={
                  (topSlab.top[1]!.y +
                    geometry.viewBox.y +
                    geometry.viewBox.height -
                    20) /
                  2
                }
                className="fill-muted text-[11px]"
              >
                {metres(building.totalHeightMm)} m
              </text>
            </>
          )}
        </g>
      </svg>
    </figure>
  );
}

type FloorEditorHandle = { save: () => Promise<boolean> };
export function BuildingModelWorkspace({
  building,
  floors,
  settingsAction,
  statusAction,
}: {
  readonly building: StorageBuildingRow;
  readonly floors: readonly StorageFloorRow[];
  readonly settingsAction?: ReactNode;
  readonly statusAction?: ReactNode;
}) {
  const t = useTranslations("StorageLayouts");
  const canManage = useCanManage();
  const query = useWorkspaceQuery();
  const params = new URLSearchParams(query);
  const defaultFloor =
    floors.find((floor) =>
      floor.storageZones.some(
        (zone) =>
          zone.placements.length + (zone.unmeasuredPalletCount ?? 0) > 0,
      ),
    ) ??
    floors.find((floor) => floor.storageZones.length > 0) ??
    floors[0];
  const selectedFloor =
    floors.find((floor) => floor.floorNumber === Number(params.get("floor"))) ??
    defaultFloor;
  const selectedFloorNumber = selectedFloor?.floorNumber ?? 1;
  const view = params.get("view") === "building" ? "building" : "storage";
  const editing =
    canManage &&
    building.status !== "ARCHIVED" &&
    params.get("editing") === "1";
  const [dirty, setDirty] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [reset, setReset] = useState(0);
  const editorRef = useRef<FloorEditorHandle>(null);
  const guard = useWorkspaceNavigationGuard({
    dirty: dirty || dialogOpen,
    pending,
    ...(dialogOpen ? { saveBlockedReason: t("finishOpenEditor") } : {}),
    save: async () => (await editorRef.current?.save()) ?? false,
    discard: () => {
      setDirty(false);
      setReset((value) => value + 1);
    },
  });
  function transition(change: {
    floor?: number;
    view?: string;
    editing?: boolean;
  }) {
    guard.requestTransition(() => {
      updateBrowserQuery(
        (query) => {
          query.set("floor", String(change.floor ?? selectedFloorNumber));
          query.set("view", change.view ?? view);
          if (change.editing ?? editing) query.set("editing", "1");
          else query.delete("editing");
          query.delete("editZone");
        },
        { event: workspaceStateEvent },
      );
    });
  }
  return (
    <div className="min-w-0 space-y-4">
      {guard.navigationPrompt}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wider text-muted">
            {building.code}
          </p>
          <h1 className="mt-1 text-xl leading-7 font-semibold text-text">
            {building.name}
          </h1>
          <p className="mt-1 text-xs text-muted">
            {t("dimensions")}: {metres(building.widthMm)} ×{" "}
            {metres(building.depthMm)} m · {t("totalHeight")}:{" "}
            {metres(building.totalHeightMm)} m
          </p>
          <p className="mt-1 text-xs text-muted">{t("mapSavedData")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statusAction}
          <div
            role="group"
            aria-label={t("buildingView")}
            className="flex rounded-lg border border-border p-1"
          >
            <Button
              type="button"
              size="sm"
              variant={view === "storage" ? "secondary" : "ghost"}
              aria-pressed={view === "storage"}
              onClick={() => transition({ view: "storage" })}
            >
              {t("storageFloorView")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "building" ? "secondary" : "ghost"}
              aria-pressed={view === "building"}
              onClick={() => transition({ view: "building", editing: false })}
            >
              {t("buildingModelView")}
            </Button>
          </div>
          {!dirty && settingsAction}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Layers3 className="size-4 text-link" />
          {t("floors")}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[...floors].reverse().map((floor) => {
            const selected = selectedFloorNumber === floor.floorNumber;
            return (
              <div
                key={floor.floorId}
                className={`flex min-w-0 overflow-hidden rounded-xl border transition ${selected ? "border-accent bg-accent-surface" : "border-border hover:border-accent/70"}`}
              >
                <Button
                  variant="ghost"
                  size="touch"
                  type="button"
                  onClick={() =>
                    transition({ floor: floor.floorNumber, editing: false })
                  }
                  aria-pressed={selected}
                  aria-label={t("floor", { floor: floor.floorNumber })}
                  className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm text-text"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={selected ? "text-link" : undefined}>
                      {t("floor", { floor: floor.floorNumber })}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {squareMetres(floor.usableAreaSqMm).toLocaleString()} m²
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted">
                    {metres(floor.widthMm ?? building.widthMm)} ×{" "}
                    {metres(floor.depthMm ?? building.depthMm)} ×{" "}
                    {metres(floor.heightMm ?? building.defaultFloorHeightMm)} m
                  </span>
                </Button>
              </div>
            );
          })}
        </div>
      </div>
      {view === "building" ? (
        <IsometricBuilding
          building={building}
          floors={floors}
          highlightedFloorNumber={selectedFloorNumber}
        />
      ) : selectedFloor ? (
        <>
          {canManage && building.status !== "ARCHIVED" ? (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => transition({ editing: !editing })}
                disabled={pending}
              >
                <PencilLine className="size-4" aria-hidden="true" />
                {editing
                  ? t("closeFloorEditing")
                  : t("editFloor", { floor: selectedFloorNumber })}
              </Button>
            </div>
          ) : null}
          <FloorForm
            key={`${selectedFloor.floorId}:${reset}`}
            warehouseId={building.warehouseId}
            detail={{ found: true, building, floors }}
            floor={selectedFloor}
            workspace={{
              editing,
              editorRef,
              onDirtyChange: setDirty,
              onPendingChange: setPending,
              onDialogChange: setDialogOpen,
              onCancel: () => transition({ editing: false }),
            }}
          />
        </>
      ) : (
        <Notice title={t("mapNoFloors")} />
      )}
    </div>
  );
}

export function StorageFloorEditor({
  buildingId,
  floorNumber,
}: {
  readonly buildingId: string;
  readonly floorNumber: number;
}) {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <FloorQuery
          warehouseId={warehouseId}
          buildingId={buildingId}
          floorNumber={floorNumber}
        />
      )}
    </QueryGate>
  );
}

function FloorQuery({
  warehouseId,
  buildingId,
  floorNumber,
}: {
  readonly warehouseId: string;
  readonly buildingId: string;
  readonly floorNumber: number;
}) {
  const t = useTranslations("StorageLayouts");
  const outcome = useBuilding(warehouseId, buildingId);
  if (outcome === undefined) return <LoadingCard />;
  if (!outcome.ok) return <QueryFailure />;
  if (!outcome.value.found)
    return <Notice tone="warning" title={t("notFound")} />;
  const floor = outcome.value.floors.find(
    (candidate) => candidate.floorNumber === floorNumber,
  );
  if (floor === undefined)
    return <Notice tone="warning" title={t("notFound")} />;
  return (
    <FloorForm
      key={`${floor.floorId}:${floor.version}`}
      warehouseId={warehouseId}
      detail={outcome.value}
      floor={floor}
    />
  );
}

function FloorForm({
  warehouseId,
  detail,
  floor: savedFloor,
  workspace,
}: {
  readonly warehouseId: string;
  readonly detail: Extract<StorageBuildingDetail, { found: true }>;
  readonly floor: StorageFloorRow;
  readonly workspace?: {
    editing: boolean;
    editorRef: Ref<FloorEditorHandle>;
    onDirtyChange: (dirty: boolean) => void;
    onPendingChange: (pending: boolean) => void;
    onDialogChange: (open: boolean) => void;
    onCancel: () => void;
  };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { selectedZoneId, setSelectedZoneId } = useFloorSelection(
    `${warehouseId}:${detail.building.buildingId}:${savedFloor.floorId}`,
    savedFloor.storageZones,
  );
  const zonePanelRef = useRef<{ create: () => void }>(null);
  const [geometryContext, setGeometryContext] = useState(detail);
  const [areaEditorOpen, setAreaEditorOpen] = useState(false);
  const [zoneEditorOpen, setZoneEditorOpen] = useState(false);
  const [zonePending, setZonePending] = useState(false);
  const dialogChange = workspace?.onDialogChange;
  useLayoutEffect(() => {
    dialogChange?.(areaEditorOpen || zoneEditorOpen);
  }, [dialogChange, areaEditorOpen, zoneEditorOpen]);
  const [baseline, setBaseline] = useState(savedFloor);
  const [receivedVersion, setReceivedVersion] = useState(savedFloor.version);
  const floor = { ...baseline, storageZones: savedFloor.storageZones };
  const t = useTranslations("StorageLayouts");
  const canManage = useCanManage();
  const editable = canManage && detail.building.status !== "ARCHIVED";
  const save = useMutation(storageLayoutRefs.saveFloor);
  const operation = useAsyncOperation({
    scope: `floor-draft:${warehouseId}:${detail.building.buildingId}:${savedFloor.floorId}`,
    describeError: (code) => code || "NETWORK_ERROR",
  });
  const [mapEditRequest, setMapEditRequest] = useState<{
    zoneId: string;
    nonce: number;
  }>();
  const [width, setWidth] = useState(
    floor.widthMm === undefined ? "" : String(metres(floor.widthMm)),
  );
  const [depth, setDepth] = useState(
    floor.depthMm === undefined ? "" : String(metres(floor.depthMm)),
  );
  const [height, setHeight] = useState(
    floor.heightMm === undefined ? "" : String(metres(floor.heightMm)),
  );
  const previousFloor = geometryContext.floors.find(
    (candidate) => candidate.floorNumber === floor.floorNumber - 1,
  );
  const baseWidthMm =
    previousFloor?.widthMm ?? geometryContext.building.widthMm;
  const baseDepthMm =
    previousFloor?.depthMm ?? geometryContext.building.depthMm;
  const initialWidthMm = floor.widthMm ?? geometryContext.building.widthMm;
  const initialDepthMm = floor.depthMm ?? geometryContext.building.depthMm;
  const [placement, setPlacement] = useState({
    xMm:
      floor.offsetXMm ??
      Math.max(0, Math.floor((baseWidthMm - initialWidthMm) / 2)),
    yMm:
      floor.offsetYMm ??
      Math.max(0, Math.floor((baseDepthMm - initialDepthMm) / 2)),
  });
  const [blocks, setBlocks] = useState<EditableBlock[]>(
    floor.reservedBlocks.map((block) => ({
      id: block.blockId,
      label: block.label,
      ...(block.color === undefined ? {} : { color: block.color }),
      xMm: block.xMm,
      yMm: block.yMm,
      widthMm: block.widthMm,
      depthMm: block.depthMm,
    })),
  );
  const [pending, setPending] = useState(false);
  const [confirmingImpact, setConfirmingImpact] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "warning";
    text: string;
  }>();
  const actualWidth =
    width === "" ? geometryContext.building.widthMm : millimetres(width);
  const actualDepth =
    depth === "" ? geometryContext.building.depthMm : millimetres(depth);
  const actualHeight =
    height === ""
      ? geometryContext.building.defaultFloorHeightMm
      : millimetres(height);
  const actualPlacement = {
    xMm: Math.max(
      0,
      Math.min(placement.xMm, Math.max(0, baseWidthMm - actualWidth)),
    ),
    yMm: Math.max(
      0,
      Math.min(placement.yMm, Math.max(0, baseDepthMm - actualDepth)),
    ),
  };
  const initialPlacement = {
    xMm:
      floor.offsetXMm ??
      Math.max(0, Math.floor((baseWidthMm - initialWidthMm) / 2)),
    yMm:
      floor.offsetYMm ??
      Math.max(0, Math.floor((baseDepthMm - initialDepthMm) / 2)),
  };
  const blockShape = (block: {
    readonly color?: string;
    readonly label: string;
    readonly xMm: number;
    readonly yMm: number;
    readonly widthMm: number;
    readonly depthMm: number;
  }) => [
    block.label,
    resolveAreaColor(block.color),
    block.xMm,
    block.yMm,
    block.widthMm,
    block.depthMm,
  ];
  const hasUnsavedFloorChanges =
    width !==
      (floor.widthMm === undefined ? "" : String(metres(floor.widthMm))) ||
    depth !==
      (floor.depthMm === undefined ? "" : String(metres(floor.depthMm))) ||
    height !==
      (floor.heightMm === undefined ? "" : String(metres(floor.heightMm))) ||
    placement.xMm !== initialPlacement.xMm ||
    placement.yMm !== initialPlacement.yMm ||
    JSON.stringify(blocks.map(blockShape)) !==
      JSON.stringify(floor.reservedBlocks.map(blockShape));
  const grossAreaSqMm = actualWidth * actualDepth;
  const reservedAreaSqMm = blocks.reduce(
    (total, block) => total + block.widthMm * block.depthMm,
    0,
  );
  const usableAreaSqMm = Math.max(0, grossAreaSqMm - reservedAreaSqMm);
  const colorOnlyChange = isStorageFloorColorOnlyChange(
    {
      floorNumber: floor.floorNumber,
      reservedBlocks: floor.reservedBlocks.map((block) => ({
        ...block,
        id: block.blockId,
      })),
    },
    { floorNumber: floor.floorNumber, reservedBlocks: blocks },
    {
      ...floor,
      widthMm: initialWidthMm,
      depthMm: initialDepthMm,
      heightMm: floor.heightMm ?? geometryContext.building.defaultFloorHeightMm,
      offsetXMm: initialPlacement.xMm,
      offsetYMm: initialPlacement.yMm,
    },
    {
      ...floor,
      widthMm: actualWidth,
      depthMm: actualDepth,
      heightMm: actualHeight,
      offsetXMm: actualPlacement.xMm,
      offsetYMm: actualPlacement.yMm,
    },
  );
  const placements = detail.floors.flatMap((candidate) =>
    candidate.storageZones.flatMap((zone) => zone.placements),
  );
  const unmeasuredCount = detail.floors.reduce(
    (sum, item) =>
      sum +
      item.storageZones.reduce(
        (count, zone) => count + (zone.unmeasuredPalletCount ?? 0),
        0,
      ),
    0,
  );
  const dirtyChange = workspace?.onDirtyChange;
  const pendingChange = workspace?.onPendingChange;
  useLayoutEffect(() => {
    dirtyChange?.(hasUnsavedFloorChanges);
  }, [dirtyChange, hasUnsavedFloorChanges]);
  useLayoutEffect(() => {
    pendingChange?.(pending || zonePending);
  }, [pendingChange, pending, zonePending]);
  // Reconcile external updates only when the local draft is clean.
  if (
    (savedFloor.version > receivedVersion ||
      detail.building.version > geometryContext.building.version) &&
    savedFloor.version >= baseline.version &&
    !hasUnsavedFloorChanges
  ) {
    setReceivedVersion(savedFloor.version);
    setGeometryContext(detail);
    setBaseline(savedFloor);
    setWidth(
      savedFloor.widthMm === undefined
        ? ""
        : String(metres(savedFloor.widthMm)),
    );
    setDepth(
      savedFloor.depthMm === undefined
        ? ""
        : String(metres(savedFloor.depthMm)),
    );
    setHeight(
      savedFloor.heightMm === undefined
        ? ""
        : String(metres(savedFloor.heightMm)),
    );
    const savedPreviousFloor = detail.floors.find(
      (item) => item.floorNumber === savedFloor.floorNumber - 1,
    );
    setPlacement({
      xMm:
        savedFloor.offsetXMm ??
        Math.max(
          0,
          Math.floor(
            ((savedPreviousFloor?.widthMm ?? detail.building.widthMm) -
              (savedFloor.widthMm ?? detail.building.widthMm)) /
              2,
          ),
        ),
      yMm:
        savedFloor.offsetYMm ??
        Math.max(
          0,
          Math.floor(
            ((savedPreviousFloor?.depthMm ?? detail.building.depthMm) -
              (savedFloor.depthMm ?? detail.building.depthMm)) /
              2,
          ),
        ),
    });
    setBlocks(
      savedFloor.reservedBlocks.map(({ blockId, ...block }) => ({
        ...block,
        id: blockId,
      })),
    );
  }
  async function saveDraft(): Promise<boolean> {
    if (!editable || pending || areaEditorOpen || zoneEditorOpen) return false;
    if (!hasUnsavedFloorChanges) return true;
    if (formRef.current && !formRef.current.reportValidity()) return false;
    if (placements.length + unmeasuredCount > 0 && !colorOnlyChange) {
      setConfirmingImpact(true);
      setMessage(undefined);
      return false;
    }
    setPending(true);
    setMessage(undefined);
    try {
      const payload = {
        warehouseId,
        buildingId: detail.building.buildingId,
        expectedBuildingVersion: geometryContext.building.version,
        expectedFloorVersion: floor.version,
        floor: {
          floorNumber: floor.floorNumber,
          ...(width === "" ? {} : { widthMm: millimetres(width) }),
          ...(depth === "" ? {} : { depthMm: millimetres(depth) }),
          ...(height === "" ? {} : { heightMm: millimetres(height) }),
          offsetXMm: actualPlacement.xMm,
          offsetYMm: actualPlacement.yMm,
          reservedBlocks: blocks,
        },
      };
      const outcome = await operation.run(() =>
        save({
          ...payload,
          requestId: operation.request(JSON.stringify(payload)),
        }),
      );
      if (!outcome) return false;
      if (!outcome.ok)
        setMessage({
          tone: "warning",
          text: storageErrorMessage(t, outcome.denial.code),
        });
      else if (!outcome.value.written)
        setMessage({
          tone: "warning",
          text: storageErrorMessage(t, outcome.value.error.code),
        });
      else {
        operation.clearRequests();
        setConfirmingImpact(false);
        const nextFloor = {
          ...floor,
          widthMm: actualWidth,
          depthMm: actualDepth,
          heightMm: actualHeight,
          offsetXMm: actualPlacement.xMm,
          offsetYMm: actualPlacement.yMm,
          reservedBlocks: blocks.map(({ id, ...block }) => ({
            ...block,
            blockId: id,
          })),
          version: floor.version + 1,
        };
        const inheritedFloor: StorageFloorRow = {
          floorId: nextFloor.floorId,
          floorNumber: nextFloor.floorNumber,
          grossAreaSqMm: nextFloor.grossAreaSqMm,
          reservedAreaSqMm: nextFloor.reservedAreaSqMm,
          usableAreaSqMm: nextFloor.usableAreaSqMm,
          version: nextFloor.version,
          storageZones: nextFloor.storageZones,
          reservedBlocks: nextFloor.reservedBlocks,
          offsetXMm: nextFloor.offsetXMm,
          offsetYMm: nextFloor.offsetYMm,
          ...(width === "" ? {} : { widthMm: actualWidth }),
          ...(depth === "" ? {} : { depthMm: actualDepth }),
          ...(height === "" ? {} : { heightMm: actualHeight }),
        };
        setBaseline(inheritedFloor);
        setPlacement(actualPlacement);
        dirtyChange?.(false);
        setMessage({ tone: "success", text: t("savedContinueToStorage") });
        requestAnimationFrame(() => {
          document
            .getElementById("storage-stacks-section")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        return true;
      }
      return false;
    } catch {
      setMessage({ tone: "warning", text: t("statusNetworkError") });
      return false;
    } finally {
      setPending(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await saveDraft();
  }
  useImperativeHandle(workspace?.editorRef, () => ({ save: saveDraft }));
  const showEditing = workspace === undefined || workspace.editing;
  const locationInspector = (
    <StorageZonesPanel
      panelRef={zonePanelRef}
      onSelectionClose={() => setSelectedZoneId(undefined)}
      compact={workspace !== undefined}
      selectedZoneId={selectedZoneId}
      onEditorOpenChange={setZoneEditorOpen}
      onSavingChange={setZonePending}
      editRequest={mapEditRequest}
      warehouseId={warehouseId}
      buildingId={detail.building.buildingId}
      floorNumber={floor.floorNumber}
      floorWidthMm={actualWidth}
      floorDepthMm={actualDepth}
      floorHeightMm={actualHeight}
      zones={floor.storageZones}
      reservedBlocks={blocks}
      layoutStatus={detail.building.status}
      blocked={hasUnsavedFloorChanges || pending}
    />
  );
  return (
    <form ref={formRef} onSubmit={submit} className="space-y-6">
      <div
        className={
          showEditing && workspace
            ? "grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]"
            : "space-y-6"
        }
      >
        <div className="min-w-0">
          <FloorPlan
            referenceBuildingId={detail.building.buildingId}
            locationInspector={workspace ? locationInspector : undefined}
            locationActions={
              workspace ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("addStorageZone")}
                  title={t("addStorageZone")}
                  disabled={
                    !editable ||
                    hasUnsavedFloorChanges ||
                    pending ||
                    zonePending
                  }
                  onClick={() => zonePanelRef.current?.create()}
                >
                  <Plus className="size-4" />
                </Button>
              ) : undefined
            }
            selectedZoneId={selectedZoneId}
            onSelectionChange={(id) => {
              setSelectedZoneId(id);
            }}
            widthMm={actualWidth}
            depthMm={actualDepth}
            heightMm={actualHeight}
            baseWidthMm={baseWidthMm}
            baseDepthMm={baseDepthMm}
            baseLabel={
              previousFloor === undefined
                ? t("buildingFootprint")
                : t("floorFootprint", { floor: previousFloor.floorNumber })
            }
            floorNumber={floor.floorNumber}
            offsetXMm={actualPlacement.xMm}
            offsetYMm={actualPlacement.yMm}
            {...(editable && showEditing && !pending
              ? { onPlacementChange: setPlacement }
              : {})}
            blocks={blocks}
            zones={floor.storageZones}
            onEditZone={
              editable && !pending && !hasUnsavedFloorChanges
                ? (zoneId) => {
                    if (!workspace)
                      setMapEditRequest({ zoneId, nonce: Date.now() });
                    if (workspace) {
                      updateBrowserQuery(
                        (query) => {
                          query.set("floor", String(floor.floorNumber));
                          query.set("editZone", zoneId);
                        },
                        { event: workspaceStateEvent },
                      );
                    }
                  }
                : undefined
            }
          />
        </div>
        {showEditing ? (
          <div className="min-w-0 space-y-6">
            {!canManage && <Notice tone="muted" title={t("layoutViewOnly")} />}

            {/*
             * Dimension overrides are the exception, not the everyday edit: a
             * floor inherits the building's footprint unless somebody says
             * otherwise. Collapsed with an "inherits" badge while untouched, so
             * the plan and zones stay the screen's subject.
             */}
            <CollapsibleSection
              label={t("floorDimensions")}
              icon={Ruler}
              {...(width === "" && depth === "" && height === ""
                ? { badge: t("inherits") }
                : { open: true })}
              contentClassName="grid gap-4 sm:grid-cols-3"
            >
              <OverrideField
                label={t("width")}
                value={width}
                onChange={setWidth}
                disabled={!editable || pending}
              />
              <OverrideField
                label={t("depth")}
                value={depth}
                onChange={setDepth}
                disabled={!editable || pending}
              />
              <OverrideField
                label={t("height")}
                value={height}
                onChange={setHeight}
                disabled={!editable || pending}
              />
            </CollapsibleSection>
            <div role="status" aria-atomic="true">
              <AreaOverview
                grossAreaSqMm={grossAreaSqMm}
                usableAreaSqMm={usableAreaSqMm}
                {...storageFootprintUsage(floor.storageZones)}
                measuredAreaPartial={floor.storageZones.some(
                  (zone) =>
                    zone.measuredAreaPartial ||
                    (zone.unmeasuredPalletCount ?? 0) > 0,
                )}
              />
            </div>
            <ReservedBlocks
              onEditorOpenChange={setAreaEditorOpen}
              editable={editable && !pending}
              blocks={blocks}
              setBlocks={setBlocks}
              floorWidthMm={actualWidth}
              floorDepthMm={actualDepth}
              floorHeightMm={actualHeight}
              zones={floor.storageZones}
            />
          </div>
        ) : null}
      </div>
      {!workspace || hasUnsavedFloorChanges || confirmingImpact ? (
        <aside className="space-y-3 rounded-xl border border-border bg-surface p-4">
          {workspace ? (
            <p role="status" className="text-sm font-medium">
              {t("unsavedFloorChanges")}
            </p>
          ) : (
            <section className="rounded-2xl border border-border bg-surface p-5">
              <p className="text-xs font-semibold tracking-[.15em] text-muted uppercase">
                {detail.building.code}
              </p>
              <h2 className="mt-1 text-lg leading-7 font-semibold text-text">
                {t("floor", { floor: floor.floorNumber })}
              </h2>
              <p className="mt-2 text-sm text-muted">
                {metres(actualWidth)} × {metres(actualDepth)} ×{" "}
                {metres(actualHeight)} m
              </p>
            </section>
          )}
          {confirmingImpact ? (
            <ChangeImpactSummary
              placements={placements}
              currentPlan={`${metres(initialWidthMm)} × ${metres(initialDepthMm)} × ${metres(floor.heightMm ?? geometryContext.building.defaultFloorHeightMm)} m`}
              proposedPlan={`${metres(actualWidth)} × ${metres(actualDepth)} × ${metres(actualHeight)} m`}
            />
          ) : null}
          {confirmingImpact ? (
            <Button
              type="button"
              className="w-full"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmingImpact(false)}
            >
              {t("backToEdit")}
            </Button>
          ) : null}
          <Button
            className={workspace ? "" : "w-full"}
            disabled={
              !editable ||
              pending ||
              !hasUnsavedFloorChanges ||
              (confirmingImpact &&
                placements.length + unmeasuredCount > 0 &&
                !colorOnlyChange)
            }
          >
            {pending
              ? t("saving")
              : confirmingImpact && !colorOnlyChange
                ? t("confirmChanges")
                : !hasUnsavedFloorChanges
                  ? t("floorSaved")
                  : detail.building.status === "ACTIVE" &&
                      placements.length + unmeasuredCount > 0 &&
                      !colorOnlyChange
                    ? t("reviewImpact")
                    : t("saveAndContinue")}
          </Button>
          {workspace ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={workspace.onCancel}
            >
              {t("cancel")}
            </Button>
          ) : null}
        </aside>
      ) : null}
      <div className="min-w-0 space-y-6">
        {!workspace ? locationInspector : null}
        {message === undefined ? null : (
          <Notice tone={message.tone} title={message.text} />
        )}
      </div>
    </form>
  );
}

function OverrideField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}) {
  const t = useTranslations("StorageLayouts");
  const inputId = useId();
  return (
    <FormField id={inputId} label={label}>
      {(field) => (
        <Input
          disabled={disabled}
          {...field}
          type="number"
          min="0.1"
          step="0.1"
          value={value}
          placeholder={t("inherits")}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  );
}

export function FloorPlan(
  props: Parameters<typeof FloorOffsetPlan>[0] & {
    readonly referenceBuildingId?: string;
    readonly locationActions?: ReactNode;
    readonly locationInspector?: ReactNode;
    readonly onEditZone?: ((zoneId: string) => void) | undefined;
    readonly selectedZoneId?: string | undefined;
    readonly onSelectionChange?:
      ((zoneId: string | undefined) => void) | undefined;
  },
) {
  const [showMeasured, setShowMeasured] = useState(false);
  const useReference =
    matchesFg1Reference(
      props.referenceBuildingId,
      props.floorNumber,
      props.zones ?? [],
    ) && !props.onPlacementChange;
  const measuredPlan = (
    <FloorMap
      {...props}
      zones={props.zones ?? []}
      offsetEditor={
        props.onPlacementChange ? <FloorOffsetPlan {...props} /> : undefined
      }
    />
  );
  if (!useReference) return measuredPlan;
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowMeasured(!showMeasured)}
        >
          {showMeasured ? "ผังสรุปตามแบบอ้างอิง" : "ดูผังตามพิกัดในฐานข้อมูล"}
        </Button>
        {!showMeasured && props.locationActions}
      </div>
      {showMeasured ? (
        measuredPlan
      ) : (
        <>
          <Fg1ReferencePreview
            zones={props.zones ?? []}
            selectedZoneId={props.selectedZoneId}
            onSelectionChange={props.onSelectionChange}
          />
          {props.locationInspector}
        </>
      )}
    </div>
  );
}

function FloorOffsetPlan({
  widthMm,
  depthMm,
  heightMm,
  baseWidthMm,
  baseDepthMm,
  baseLabel,
  floorNumber,
  offsetXMm,
  offsetYMm,
  onPlacementChange,
  blocks,
  zones = [],
}: {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  readonly baseWidthMm: number;
  readonly baseDepthMm: number;
  readonly baseLabel: string;
  readonly floorNumber: number;
  readonly offsetXMm: number;
  readonly offsetYMm: number;
  readonly onPlacementChange?:
    | ((placement: { readonly xMm: number; readonly yMm: number }) => void)
    | undefined;
  readonly blocks: readonly EditableBlock[];
  readonly zones?: readonly StorageZoneRow[];
}) {
  const t = useTranslations("StorageLayouts");
  const [view, setView] = useState<"3d" | "plan">("3d");
  return (
    <figure className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <figcaption className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-text">{t("floorSpace")}</p>
          <p className="mt-1 text-xs text-muted">
            {metres(widthMm)} × {metres(depthMm)} × {metres(heightMm)} m
          </p>
        </div>
        <StorageViewModeToggle
          value={view}
          onChange={setView}
          label={t("viewMode")}
          planLabel={t("planView")}
          threeDLabel={t("threeDView")}
        />
      </figcaption>
      <div className="relative">
        {view === "3d" ? (
          <FloorVolume
            widthMm={widthMm}
            depthMm={depthMm}
            heightMm={heightMm}
            baseWidthMm={baseWidthMm}
            baseDepthMm={baseDepthMm}
            floorNumber={floorNumber}
            offsetXMm={offsetXMm}
            offsetYMm={offsetYMm}
            onPlacementChange={onPlacementChange}
            blocks={blocks}
            zones={zones}
          />
        ) : (
          <FloorPlanDrawing
            widthMm={widthMm}
            depthMm={depthMm}
            baseWidthMm={baseWidthMm}
            baseDepthMm={baseDepthMm}
            offsetXMm={offsetXMm}
            offsetYMm={offsetYMm}
            blocks={blocks}
            zones={zones}
          />
        )}
        <span
          aria-live="polite"
          className="pointer-events-none absolute right-3 bottom-3 rounded-md border border-border/80 bg-background/90 px-3 py-2 text-xs text-muted tabular-nums shadow-sm backdrop-blur-sm"
        >
          X {metres(offsetXMm)} m · Y {metres(offsetYMm)} m
        </span>
      </div>
      {onPlacementChange && (
        <p className="mt-2 text-xs text-muted">{t("dragHint")}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
        <span>
          <i className="mr-2 inline-block size-3 rounded-sm bg-success" />
          {t("available")}
        </span>
        <ReservedAreaLegend areas={blocks} />
        <span>
          <i className="mr-2 inline-block size-3 rounded-sm border border-success bg-success-surface" />
          {t("storageZones")}
        </span>
        {zones.some((zone) => zone.placements.length > 0) && (
          <>
            <span>
              <i className="mr-2 inline-block size-3 rounded-sm border border-dashed border-warning bg-warning/40" />
              {t("placementReserved")}
            </span>
            <span>
              <i className="mr-2 inline-block size-3 rounded-sm border border-success bg-success/60" />
              {t("placementStored")}
            </span>
          </>
        )}
        <span>
          <i className="mr-2 inline-block size-3 rounded-sm border border-dashed border-muted" />
          {baseLabel}
        </span>
      </div>
    </figure>
  );
}

function FloorVolume({
  widthMm,
  depthMm,
  heightMm,
  baseWidthMm,
  baseDepthMm,
  floorNumber,
  offsetXMm,
  offsetYMm,
  onPlacementChange,
  blocks,
  zones,
}: {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  readonly baseWidthMm: number;
  readonly baseDepthMm: number;
  readonly floorNumber: number;
  readonly offsetXMm: number;
  readonly offsetYMm: number;
  readonly onPlacementChange?:
    | ((placement: { readonly xMm: number; readonly yMm: number }) => void)
    | undefined;
  readonly blocks: readonly EditableBlock[];
  readonly zones: readonly StorageZoneRow[];
}) {
  const t = useTranslations("StorageLayouts");
  const patternId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragState = useRef<
    | {
        readonly pointerId: number;
        readonly startX: number;
        readonly startY: number;
        readonly offsetXMm: number;
        readonly offsetYMm: number;
      }
    | undefined
  >(undefined);
  const scale = 0.012;
  const geometry = buildIsometricBuilding(
    [
      {
        floorNumber,
        widthMm,
        depthMm,
        heightMm,
        offsetXMm,
        offsetYMm,
      },
    ],
    {
      scale,
      gap: 0,
      envelopeWidthMm: baseWidthMm,
      envelopeDepthMm: baseDepthMm,
    },
  );
  const slab = geometry.slabs[0]!;
  const topPoint = (x: number, y: number) =>
    projectIsometricPoint({
      x: (x + offsetXMm) * scale,
      y: (y + offsetYMm) * scale,
      z: heightMm * scale,
    });
  const occupancy = zones.flatMap((zone) =>
    storagePlacementBoxes(zone.placements, zone),
  );
  const palletPoint = (x: number, y: number, z: number) =>
    projectIsometricPoint({
      x: (x + offsetXMm) * scale,
      y: (y + offsetYMm) * scale,
      z: (heightMm + z) * scale,
    });
  const baseFootprint = [
    projectIsometricPoint({ x: 0, y: 0, z: 0 }),
    projectIsometricPoint({ x: baseWidthMm * scale, y: 0, z: 0 }),
    projectIsometricPoint({
      x: baseWidthMm * scale,
      y: baseDepthMm * scale,
      z: 0,
    }),
    projectIsometricPoint({ x: 0, y: baseDepthMm * scale, z: 0 }),
  ];
  const displayedGridStepMm = Math.max(
    1_000,
    Math.ceil(Math.max(baseWidthMm, baseDepthMm) / 30_000) * 1_000,
  );
  const baseGridLines = [
    ...Array.from(
      { length: Math.max(0, Math.ceil(baseWidthMm / displayedGridStepMm) - 1) },
      (_, index) => {
        const x = (index + 1) * displayedGridStepMm;
        return [
          projectIsometricPoint({ x: x * scale, y: 0, z: 0 }),
          projectIsometricPoint({
            x: x * scale,
            y: baseDepthMm * scale,
            z: 0,
          }),
        ] as const;
      },
    ),
    ...Array.from(
      { length: Math.max(0, Math.ceil(baseDepthMm / displayedGridStepMm) - 1) },
      (_, index) => {
        const y = (index + 1) * displayedGridStepMm;
        return [
          projectIsometricPoint({ x: 0, y: y * scale, z: 0 }),
          projectIsometricPoint({
            x: baseWidthMm * scale,
            y: y * scale,
            z: 0,
          }),
        ] as const;
      },
    ),
  ];
  const heightGuideX = slab.top[1]!.x + 22;
  const heightTopY = slab.top[1]!.y;
  const heightBottomY = slab.right[3]!.y;
  const visualPoints = [
    ...baseFootprint,
    ...slab.top,
    ...slab.left,
    ...slab.right,
    ...occupancy.flatMap((box) =>
      storagePlacementCorners(box).map((p) => palletPoint(p.x, p.y, p.z)),
    ),
    { x: heightGuideX + 48, y: heightBottomY },
  ];
  const visualXs = visualPoints.map((point) => point.x);
  const visualYs = visualPoints.map((point) => point.y);
  const visualPadding = 36;
  const visualViewBox = {
    x: Math.min(...visualXs) - visualPadding,
    y: Math.min(...visualYs) - visualPadding,
    width: Math.max(...visualXs) - Math.min(...visualXs) + visualPadding * 2,
    height: Math.max(...visualYs) - Math.min(...visualYs) + visualPadding * 2,
  };
  const clampPlacement = (xMm: number, yMm: number) => ({
    xMm: Math.max(0, Math.min(xMm, Math.max(0, baseWidthMm - widthMm))),
    yMm: Math.max(0, Math.min(yMm, Math.max(0, baseDepthMm - depthMm))),
  });
  const clientPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (svg === null || matrix === null || matrix === undefined)
      return undefined;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  };
  const finishDrag = (pointerId: number) => {
    if (dragState.current?.pointerId !== pointerId) return;
    svgRef.current?.releasePointerCapture(pointerId);
    dragState.current = undefined;
  };
  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label={t("volumeLabel")}
      viewBox={`${visualViewBox.x} ${visualViewBox.y} ${visualViewBox.width} ${visualViewBox.height}`}
      className="h-[28rem] w-full rounded-xl border border-accent/60 bg-background"
      onPointerMove={(event) => {
        if (!onPlacementChange) return;
        const drag = dragState.current;
        if (drag === undefined || drag.pointerId !== event.pointerId) return;
        const current = clientPoint(event.clientX, event.clientY);
        if (current === undefined) return;
        const delta = unprojectIsometricDelta(
          { x: current.x - drag.startX, y: current.y - drag.startY },
          scale,
        );
        const snap = (value: number) => Math.round(value / 1_000) * 1_000;
        onPlacementChange(
          clampPlacement(
            snap(drag.offsetXMm + delta.x),
            snap(drag.offsetYMm + delta.y),
          ),
        );
      }}
      onPointerUp={(event) => finishDrag(event.pointerId)}
      onPointerCancel={(event) => finishDrag(event.pointerId)}
    >
      <defs>
        <pattern
          id={patternId}
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 24 0 L 0 0 0 24"
            className="fill-none stroke-border/40"
            strokeWidth="0.75"
          />
        </pattern>
      </defs>
      <rect
        x={visualViewBox.x}
        y={visualViewBox.y}
        width={visualViewBox.width}
        height={visualViewBox.height}
        fill={`url(#${patternId})`}
        opacity="0.45"
      />
      <polygon
        points={pointsAttribute(baseFootprint)}
        className="fill-surface/40 stroke-muted"
        strokeDasharray="6 6"
      />
      {baseGridLines.map(([start, end], index) => (
        <line
          key={index}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          className="stroke-muted/35"
          strokeWidth="0.75"
        />
      ))}
      <g
        role={onPlacementChange ? "button" : undefined}
        tabIndex={onPlacementChange ? 0 : undefined}
        aria-label={t("dragFloor", { floor: floorNumber })}
        className={
          onPlacementChange
            ? "cursor-grab outline-none active:cursor-grabbing focus-visible:[&>polygon]:stroke-text"
            : undefined
        }
        style={{ touchAction: onPlacementChange ? "none" : "auto" }}
        onPointerDown={(event) => {
          if (!onPlacementChange) return;
          const start = clientPoint(event.clientX, event.clientY);
          if (start === undefined) return;
          svgRef.current?.setPointerCapture(event.pointerId);
          dragState.current = {
            pointerId: event.pointerId,
            startX: start.x,
            startY: start.y,
            offsetXMm,
            offsetYMm,
          };
        }}
        onKeyDown={(event) => {
          if (!onPlacementChange) return;
          const movement: readonly [number, number] | undefined = {
            ArrowLeft: [-1_000, 0],
            ArrowRight: [1_000, 0],
            ArrowUp: [0, -1_000],
            ArrowDown: [0, 1_000],
          }[event.key] as readonly [number, number] | undefined;
          if (movement === undefined) return;
          event.preventDefault();
          onPlacementChange(
            clampPlacement(offsetXMm + movement[0], offsetYMm + movement[1]),
          );
        }}
      >
        <polygon
          points={pointsAttribute(slab.left)}
          className="fill-surface stroke-accent/60"
        />
        <polygon
          points={pointsAttribute(slab.left)}
          className="fill-accent/20"
        />
        <polygon
          points={pointsAttribute(slab.right)}
          className="fill-surface stroke-accent/70"
        />
        <polygon
          points={pointsAttribute(slab.right)}
          className="fill-accent/30"
        />
        <polygon
          points={pointsAttribute(slab.top)}
          className="fill-success/15 stroke-accent"
          strokeWidth="2"
        />
        {blocks.map((block) => (
          <ReservedAreaShape
            key={block.id}
            points={[
              topPoint(block.xMm, block.yMm),
              topPoint(block.xMm + block.widthMm, block.yMm),
              topPoint(block.xMm + block.widthMm, block.yMm + block.depthMm),
              topPoint(block.xMm, block.yMm + block.depthMm),
            ]}
            color={block.color}
            label={block.label}
            mode="3d"
          />
        ))}
        {zones.map((zone) => {
          const shape = [
            topPoint(zone.xMm, zone.yMm),
            topPoint(zone.xMm + zone.widthMm, zone.yMm),
            topPoint(zone.xMm + zone.widthMm, zone.yMm + zone.depthMm),
            topPoint(zone.xMm, zone.yMm + zone.depthMm),
          ];
          const labelPoint = topPoint(
            zone.xMm + zone.widthMm / 2,
            zone.yMm + zone.depthMm / 2,
          );
          return (
            <g key={zone.zoneId}>
              <polygon
                points={pointsAttribute(shape)}
                className="fill-success/35 stroke-success"
                strokeWidth="2"
              />
              <text
                x={labelPoint.x}
                y={labelPoint.y + 8}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-text text-[9px] font-bold"
              >
                {zone.code.split("-").at(-1)} · {locationInventory(zone).units}
              </text>
            </g>
          );
        })}
        <StoragePlacementLayer
          mode="3d"
          boxes={occupancy}
          point={palletPoint}
          reservedLabel={t("placementReserved")}
          storedLabel={t("placementStored")}
          moveSourceLabel={t("placementMoveSource")}
          moveInTransitLabel={t("placementMoveInTransit")}
          moveTargetLabel={t("placementMoveTarget")}
        />
      </g>
      <DimensionGuide
        start={slab.top[0]!}
        end={slab.top[1]!}
        label={`${t("widthShort")} ${metres(widthMm)} m`}
        offsetY={-10}
      />
      <DimensionGuide
        start={slab.top[0]!}
        end={slab.top[3]!}
        label={`${t("depthShort")} ${metres(depthMm)} m`}
        offsetY={-10}
      />
      <line
        x1={heightGuideX}
        y1={heightTopY}
        x2={heightGuideX}
        y2={heightBottomY}
        className="stroke-accent"
        strokeWidth="1.5"
      />
      <line
        x1={heightGuideX - 4}
        y1={heightTopY}
        x2={heightGuideX + 4}
        y2={heightTopY}
        className="stroke-accent"
      />
      <line
        x1={heightGuideX - 4}
        y1={heightBottomY}
        x2={heightGuideX + 4}
        y2={heightBottomY}
        className="stroke-accent"
      />
      <text
        x={heightGuideX + 7}
        y={(heightTopY + heightBottomY) / 2}
        dominantBaseline="central"
        className="fill-accent text-[11px] font-semibold"
      >
        {t("heightShort")} {metres(heightMm)} m
      </text>
    </svg>
  );
}

function DimensionGuide({
  start,
  end,
  label,
  offsetY,
}: {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly label: string;
  readonly offsetY: number;
}) {
  return (
    <g>
      <line
        x1={start.x}
        y1={start.y + offsetY}
        x2={end.x}
        y2={end.y + offsetY}
        className="stroke-accent"
        strokeDasharray="4 4"
      />
      <text
        x={(start.x + end.x) / 2}
        y={(start.y + end.y) / 2 + offsetY - 5}
        textAnchor="middle"
        className="fill-accent text-[11px] font-semibold"
      >
        {label}
      </text>
    </g>
  );
}

function FloorPlanDrawing({
  widthMm,
  depthMm,
  baseWidthMm,
  baseDepthMm,
  offsetXMm,
  offsetYMm,
  blocks,
  zones,
}: {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly baseWidthMm: number;
  readonly baseDepthMm: number;
  readonly offsetXMm: number;
  readonly offsetYMm: number;
  readonly blocks: readonly EditableBlock[];
  readonly zones: readonly StorageZoneRow[];
}) {
  const t = useTranslations("StorageLayouts");
  const drawingWidth = Math.max(widthMm + offsetXMm, baseWidthMm, 1);
  const drawingDepth = Math.max(depthMm + offsetYMm, baseDepthMm, 1);
  const padding = Math.max(drawingWidth, drawingDepth) * 0.09;
  const labelSize = Math.max(drawingWidth, drawingDepth) / 38;
  const gridStep = 1_000;
  return (
    <svg
      role="img"
      aria-label={t("planLabel")}
      viewBox={`${-padding} ${-padding} ${drawingWidth + padding * 2} ${drawingDepth + padding * 2}`}
      className="h-[28rem] w-full rounded-xl border border-accent/60 bg-background"
    >
      <defs>
        <pattern
          id="storage-floor-grid"
          width={gridStep}
          height={gridStep}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`}
            className="fill-none stroke-border/50"
            strokeWidth={Math.max(20, drawingWidth / 1_500)}
          />
        </pattern>
        <pattern
          id="storage-reserved-hatch"
          width="500"
          height="500"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="500"
            className="stroke-warning"
            strokeWidth="90"
          />
        </pattern>
      </defs>
      <rect
        x={-padding}
        y={-padding}
        width={drawingWidth + padding * 2}
        height={drawingDepth + padding * 2}
        fill="url(#storage-floor-grid)"
      />
      <rect
        width={baseWidthMm}
        height={baseDepthMm}
        className="fill-none stroke-muted"
        strokeDasharray="6 4"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={offsetXMm}
        y={offsetYMm}
        width={widthMm}
        height={depthMm}
        className="fill-accent/15 stroke-accent"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={offsetXMm + widthMm / 2}
        y={-padding * 0.35}
        textAnchor="middle"
        className="fill-accent font-semibold"
        style={{ fontSize: labelSize }}
      >
        {metres(widthMm)} m
      </text>
      <text
        x={offsetXMm + widthMm + padding * 0.32}
        y={offsetYMm + depthMm / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-accent font-semibold"
        style={{ fontSize: labelSize }}
      >
        {metres(depthMm)} m
      </text>
      {blocks.map((block) => (
        <ReservedAreaShape
          key={block.id}
          points={[
            { x: offsetXMm + block.xMm, y: offsetYMm + block.yMm },
            {
              x: offsetXMm + block.xMm + block.widthMm,
              y: offsetYMm + block.yMm,
            },
            {
              x: offsetXMm + block.xMm + block.widthMm,
              y: offsetYMm + block.yMm + block.depthMm,
            },
            {
              x: offsetXMm + block.xMm,
              y: offsetYMm + block.yMm + block.depthMm,
            },
          ]}
          color={block.color}
          label={block.label}
          mode="plan"
          fontSize={labelSize}
        />
      ))}
      {zones.map((zone) => (
        <g key={zone.zoneId}>
          <rect
            x={offsetXMm + zone.xMm}
            y={offsetYMm + zone.yMm}
            width={zone.widthMm}
            height={zone.depthMm}
            className="fill-success/30 stroke-success"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={offsetXMm + zone.xMm + zone.widthMm / 2}
            y={offsetYMm + zone.yMm + zone.depthMm / 2}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-text font-bold"
            style={{ fontSize: labelSize * 0.78 }}
          >
            {zone.code.split("-").at(-1)} · {locationInventory(zone).units}
          </text>
        </g>
      ))}
      <StoragePlacementLayer
        mode="plan"
        boxes={zones.flatMap((zone) =>
          storagePlacementBoxes(zone.placements, {
            xMm: zone.xMm + offsetXMm,
            yMm: zone.yMm + offsetYMm,
          }),
        )}
        reservedLabel={t("placementReserved")}
        storedLabel={t("placementStored")}
        moveSourceLabel={t("placementMoveSource")}
        moveInTransitLabel={t("placementMoveInTransit")}
        moveTargetLabel={t("placementMoveTarget")}
      />
    </svg>
  );
}

export function ReservedBlocks({
  blocks,
  setBlocks,
  floorWidthMm,
  floorDepthMm,
  floorHeightMm,
  zones,
  editable = true,
  onEditorOpenChange,
}: {
  readonly blocks: readonly EditableBlock[];
  readonly setBlocks: (blocks: EditableBlock[]) => void;
  readonly floorWidthMm: number;
  readonly floorDepthMm: number;
  readonly floorHeightMm: number;
  readonly zones: readonly StorageZoneRow[];
  readonly editable?: boolean;
  readonly onEditorOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const [dialogOpen, setDialogOpen] = useState(false);
  useLayoutEffect(() => {
    onEditorOpenChange?.(dialogOpen && editable);
    return () => onEditorOpenChange?.(false);
  }, [dialogOpen, editable, onEditorOpenChange]);
  const [editingBlockId, setEditingBlockId] = useState<string>();
  const [draft, setDraft] = useState({
    label: "",
    color: resolveAreaColor(),
    x: "0",
    y: "0",
    width: "1",
    depth: "1",
  });
  const openDialog = (open: boolean) => {
    if (open && !editable) return;
    setDialogOpen(open);
    if (!open) setEditingBlockId(undefined);
  };
  const startNewReservedBlock = () => {
    if (!editable) return;
    setEditingBlockId(undefined);
    setDraft({
      label: t("newReservedZoneLabel", { number: blocks.length + 1 }),
      color: resolveAreaColor(),
      x: "0",
      y: "0",
      width: "1",
      depth: "1",
    });
  };
  const startEditingReservedBlock = (block: EditableBlock) => {
    if (!editable) return;
    setEditingBlockId(block.id);
    setDraft({
      label: block.label,
      color: resolveAreaColor(block.color),
      x: String(metres(block.xMm)),
      y: String(metres(block.yMm)),
      width: String(metres(block.widthMm)),
      depth: String(metres(block.depthMm)),
    });
    setDialogOpen(true);
  };
  const draftBlock = {
    id: editingBlockId ?? "draft",
    label: draft.label.trim(),
    color: draft.color,
    xMm: millimetres(draft.x),
    yMm: millimetres(draft.y),
    widthMm: millimetres(draft.width),
    depthMm: millimetres(draft.depth),
  };
  const otherBlocks = blocks.filter((block) => block.id !== editingBlockId);
  const overlaps = [...otherBlocks, ...zones].some(
    (area) =>
      draftBlock.xMm < area.xMm + area.widthMm &&
      draftBlock.xMm + draftBlock.widthMm > area.xMm &&
      draftBlock.yMm < area.yMm + area.depthMm &&
      draftBlock.yMm + draftBlock.depthMm > area.yMm,
  );
  const validDraft =
    draftBlock.label !== "" &&
    draftBlock.xMm >= 0 &&
    draftBlock.yMm >= 0 &&
    draftBlock.widthMm > 0 &&
    draftBlock.depthMm > 0 &&
    draftBlock.xMm + draftBlock.widthMm <= floorWidthMm &&
    draftBlock.yMm + draftBlock.depthMm <= floorDepthMm &&
    !overlaps;
  const saveReservedBlock = () => {
    if (!editable) return;
    const nextBlock = {
      ...draftBlock,
      id: editingBlockId ?? localEntityId(),
    };
    setBlocks(
      editingBlockId === undefined
        ? [...blocks, nextBlock]
        : blocks.map((block) =>
            block.id === editingBlockId ? nextBlock : block,
          ),
    );
    setDialogOpen(false);
    setEditingBlockId(undefined);
  };
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-text">{t("reservedZones")}</h2>
        <Dialog open={dialogOpen && editable} onOpenChange={openDialog}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              onClick={startNewReservedBlock}
              disabled={!editable}
            >
              <Plus className="size-4" />
              {t("addZone")}
            </Button>
          </DialogTrigger>
          <DialogContent closeLabel={t("closeDialog")} className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>
                {t(
                  editingBlockId === undefined
                    ? "addReservedZoneTitle"
                    : "editReservedZoneTitle",
                )}
              </DialogTitle>
              <DialogDescription>
                {t(
                  editingBlockId === undefined
                    ? "addReservedZoneDescription"
                    : "editReservedZoneDescription",
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.05fr)_minmax(19rem,0.95fr)]">
              <StorageZoneDraftPreview
                floorWidthMm={floorWidthMm}
                floorDepthMm={floorDepthMm}
                floorHeightMm={floorHeightMm}
                zoneX={draft.x}
                zoneY={draft.y}
                zoneWidth={draft.width}
                zoneDepth={draft.depth}
                stackHeight={String(metres(floorHeightMm))}
                zones={zones}
                reservedBlocks={otherBlocks}
                variant="reserved"
                selectedColor={draft.color}
                selectedLabel={draft.label}
                onPositionChange={({ xMm, yMm }) =>
                  setDraft((current) => ({
                    ...current,
                    x: String(metres(xMm)),
                    y: String(metres(yMm)),
                  }))
                }
              />
              <div className="order-first grid content-start gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="reserved-zone-dialog-label">
                    {t("zoneLabel")}
                  </Label>
                  <Input
                    id="reserved-zone-dialog-label"
                    className="mt-2"
                    value={draft.label}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        label: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <AreaColorPicker
                    value={draft.color}
                    onChange={(color) =>
                      setDraft((current) => ({ ...current, color }))
                    }
                  />
                </div>
                {(
                  [
                    ["x", "x", 0, floorWidthMm],
                    ["y", "y", 0, floorDepthMm],
                    ["zoneWidth", "width", 0.1, floorWidthMm],
                    ["zoneDepth", "depth", 0.1, floorDepthMm],
                  ] as const
                ).map(([labelKey, field, min, max]) => (
                  <div key={field}>
                    <Label htmlFor={`reserved-zone-dialog-${field}`}>
                      {t(labelKey)}
                    </Label>
                    <Input
                      id={`reserved-zone-dialog-${field}`}
                      className="mt-2"
                      type="number"
                      min={min}
                      max={metres(max)}
                      step="0.1"
                      value={draft[field]}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [field]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t("cancel")}
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={saveReservedBlock}
                disabled={!validDraft}
              >
                {editingBlockId === undefined ? (
                  <Plus className="size-4" />
                ) : (
                  <PencilLine className="size-4" />
                )}
                {t(
                  editingBlockId === undefined
                    ? "addReservedZoneAction"
                    : "saveReservedZoneChanges",
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        {blocks.map((block) => (
          <article
            key={block.id}
            className="min-w-0 rounded-xl border border-border bg-background p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="flex items-center gap-2 font-semibold text-text">
                  <span
                    aria-hidden="true"
                    className="size-5 shrink-0 rounded border border-border"
                    style={{ backgroundColor: resolveAreaColor(block.color) }}
                  />
                  {block.label}
                </h3>
                <p className="mt-1 text-xs text-muted tabular-nums">
                  X {metres(block.xMm)} · Y {metres(block.yMm)} m · W{" "}
                  {metres(block.widthMm)} × D {metres(block.depthMm)} m
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => startEditingReservedBlock(block)}
                  disabled={!editable}
                  aria-label={t("editReservedZone", { label: block.label })}
                >
                  <PencilLine className="size-3.5" />
                  {t("edit")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!editable}
                  onClick={() =>
                    editable &&
                    setBlocks(blocks.filter((current) => current !== block))
                  }
                  aria-label={t("removeReservedZone", { label: block.label })}
                >
                  <Trash2 className="size-3.5" />
                  {t("remove")}
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function StorageBuildingReview({
  buildingId,
}: {
  readonly buildingId: string;
}) {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <ReviewContent warehouseId={warehouseId} buildingId={buildingId} />
      )}
    </QueryGate>
  );
}

function ReviewContent({
  warehouseId,
  buildingId,
}: {
  readonly warehouseId: string;
  readonly buildingId: string;
}) {
  const t = useTranslations("StorageLayouts");
  const router = useRouter();
  const workspace = useWorkspace();
  const canActivate =
    workspace.permissionsReady &&
    workspace.navigationPermissions.includes(
      "masterData.storageLayout.activate",
    );
  const outcome = useBuilding(warehouseId, buildingId);
  const activate = useMutation(storageLayoutRefs.activate);
  const operation = useAsyncOperation({
    scope: `building-review:${warehouseId}:${buildingId}`,
    describeError: (code) => code || "NETWORK_ERROR",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (outcome === undefined) return <LoadingCard />;
  if (!outcome.ok) return <QueryFailure />;
  if (!outcome.value.found)
    return <Notice tone="warning" title={t("notFound")} />;
  const { building: savedBuilding, floors } = outcome.value;
  const unmeasuredPalletCount = floors.reduce(
    (sum, floor) =>
      sum +
      floor.storageZones.reduce(
        (count, zone) => count + (zone.unmeasuredPalletCount ?? 0),
        0,
      ),
    0,
  );
  const building = {
    ...savedBuilding,
    unmeasuredPalletCount,
    measuredAreaPartial: unmeasuredPalletCount > 0,
  };
  const storageStackCount = floors.reduce(
    (total, floor) => total + floor.storageZones.length,
    0,
  );
  async function submit() {
    setPending(true);
    setError(undefined);
    try {
      const payload = {
        warehouseId,
        buildingId,
        expectedVersion: building.version,
      };
      const result = await operation.run(() =>
        activate({
          ...payload,
          requestId: operation.request(JSON.stringify(payload)),
        }),
      );
      if (!result) return;
      if (!result.ok) setError(result.denial.code);
      else if (!result.value.written) setError(result.value.error.code);
      else {
        operation.clearRequests();
        router.push(storageBuildingPath(buildingId));
      }
    } catch {
      setError("NETWORK_ERROR");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="min-w-0 space-y-6">
        <IsometricBuilding building={building} floors={floors} />
        <DataTable<StorageFloorRow>
          caption={t("reviewTitle")}
          rows={floors}
          rowKey={(floor) => floor.floorId}
          columns={[
            {
              key: "floor",
              header: t("floors"),
              rowHeader: true,
              monospace: false,
              cellClassName: "font-semibold",
              render: (floor) => t("floor", { floor: floor.floorNumber }),
            },
            {
              key: "dimensions",
              header: t("dimensions"),
              render: (floor) =>
                `${metres(floor.widthMm ?? building.widthMm)} × ${metres(floor.depthMm ?? building.depthMm)} m`,
            },
            {
              key: "usableArea",
              header: t("usableArea"),
              render: (floor) => `${squareMetres(floor.usableAreaSqMm)} m²`,
            },
            {
              key: "reservedArea",
              header: t("blockedArea"),
              render: (floor) => `${squareMetres(floor.reservedAreaSqMm)} m²`,
            },
            {
              key: "storageZones",
              header: t("storageZones"),
              render: (floor) => floor.storageZones.length,
            },
            {
              key: "actions",
              header: t("actions"),
              render: (floor) =>
                building.status === "ARCHIVED" ? null : (
                  <Button size="sm" variant="ghost" asChild>
                    <Link
                      href={storageFloorPath(buildingId, floor.floorNumber)}
                    >
                      <Zap className="size-3.5" />
                      {t("quickChange")}
                    </Link>
                  </Button>
                ),
            },
          ]}
        />
      </div>
      <aside className="space-y-4">
        <Notice
          tone={
            building.status === "DRAFT" && storageStackCount > 0
              ? "success"
              : building.status === "DRAFT"
                ? "warning"
                : "muted"
          }
          title={
            building.status === "DRAFT"
              ? storageStackCount > 0
                ? t("readyToActivate")
                : t("storageStackRequired")
              : statusLabel(t, building.status)
          }
          body={
            storageStackCount > 0
              ? t("validationPassed")
              : t("storageStackRequiredHelp")
          }
        />
        {error === undefined ? null : (
          <Notice tone="warning" title={storageErrorMessage(t, error)} />
        )}
        {building.status === "DRAFT" && canActivate ? (
          <Button
            className="w-full"
            variant="success"
            disabled={pending || storageStackCount === 0}
            onClick={submit}
          >
            {pending ? t("activating") : t("activate")}
          </Button>
        ) : null}
      </aside>
    </div>
  );
}
