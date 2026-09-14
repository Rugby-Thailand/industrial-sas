"use client";

import { storageFootprintUsage } from "../../../convex/model/storageLayout/areaUsage";
import { AreaOverview } from "./AreaOverview";
import { StorageViewModeToggle } from "@/components/storageLayouts/StorageZoneVisualizer";
import { StorageZoneDraftPreview } from "@/components/storageLayouts/StorageZoneDraftPreview";
export { StorageZoneDraftPreview } from "@/components/storageLayouts/StorageZoneDraftPreview";
import { rectanglesOverlap } from "@/lib/storageLayouts/storagePlacementGeometry";

import { useMutation, useQuery } from "convex/react";
import {
  Building2,
  Archive,
  ArrowRightLeft,
  Eye,
  X,
  CheckCircle2,
  Layers3,
  PencilLine,
  Plus,
  QrCode,
  Ruler,
  Search,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import {
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { StoragePlacementLayer } from "@/components/storageLayouts/StorageZoneVisualizer";
import { FloorMap } from "@/components/storageLayouts/FloorMap";
import { QueryGate } from "@/components/system/QueryGate";
import { DataTable } from "@/components/table/DataTable";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useRouter } from "@/i18n/navigation";
import {
  storageBuildingPath,
  storageFloorPath,
  storageReviewPath,
  ROUTES,
} from "@/lib/navigation";
import {
  storageLayoutRefs,
  type StorageBuildingDetail,
  type StorageBuildingRow,
  type StorageFloorRow,
  type StorageLayoutStatus,
  type StorageReservedBlockRow,
  type StorageStackPlacementRow,
  type StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";
import {
  buildIsometricBuilding,
  pointsAttribute,
  projectIsometricPoint,
  unprojectIsometricDelta,
} from "@/lib/storageLayouts/isometricGeometry";

import {
  maximumOccupiedHeight,
  uniqueStoragePallets,
  occupiedStorageFootprintAreaSqMm,
  storagePlacementBoxes,
  storagePlacementCorners,
} from "@/lib/storageLayouts/storagePlacementGeometry";
import { palletPath, useCanManage } from "@/features/finishedGoods/shared";

import {
  StorageLocationCatalogue,
  type CatalogueFilters,
} from "./StorageLocationCatalogue";

const metres = (millimetres: number) => millimetres / 1_000;
const millimetres = (value: string) => Math.round(Number(value) * 1_000);
const squareMetres = (area: number) => area / 1_000_000;
const requestId = () => crypto.randomUUID();

function storageErrorMessage(
  t: ReturnType<typeof useTranslations<"StorageLayouts">>,
  code: string,
) {
  if (code === "LOCATION_OCCUPIED") return t("occupiedChangeBlocked");
  if (code === "VERSION_CONFLICT") return t("layoutChangedRetry");
  return t("writeError", { code });
}

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

function statusTone(status: StorageLayoutStatus): BadgeTone {
  return status === "ACTIVE"
    ? "success"
    : status === "DRAFT"
      ? "pending"
      : "muted";
}

function LoadingCard() {
  return (
    <div className="min-h-48 animate-pulse rounded-2xl border border-border bg-surface" />
  );
}

function QueryFailure() {
  const t = useTranslations("StorageLayouts");
  return <Notice tone="warning" title={t("loadError")} />;
}

function ChangeImpactSummary({
  placements,
  currentPlan,
  proposedPlan,
}: {
  readonly placements: readonly StorageStackPlacementRow[];
  readonly currentPlan?: string;
  readonly proposedPlan?: string;
}) {
  const t = useTranslations("StorageLayouts");
  const occupiedHeightMm = maximumOccupiedHeight(placements);
  return (
    <section
      role="alert"
      className="rounded-xl border border-warning/60 bg-warning-surface p-4"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="min-w-0">
          <h3 className="font-semibold text-text">{t("impactReviewTitle")}</h3>
          <p className="mt-1 text-sm text-muted">
            {t("impactReviewDescription")}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <Metric
          label={t("affectedHandlingUnits")}
          value={String(uniqueStoragePallets(placements).length)}
        />
        <Metric
          label={t("occupiedHeight")}
          value={`${metres(occupiedHeightMm)} m`}
        />
        {currentPlan === undefined ? null : (
          <Metric label={t("currentPlan")} value={currentPlan} />
        )}
        {proposedPlan === undefined ? null : (
          <Metric label={t("proposedPlan")} value={proposedPlan} />
        )}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {uniqueStoragePallets(placements).map((placement) => (
          <span
            key={placement.placementId}
            className="rounded-full border border-warning/35 bg-background px-2.5 py-1 font-mono text-xs text-text"
          >
            {placement.lpn}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">{t("impactAuditHelp")}</p>
    </section>
  );
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
  const outcome = useQuery(storageLayoutRefs.list, {
    warehouseId,
  });
  if (outcome === undefined) return <LoadingCard />;
  if (!outcome.ok) return <QueryFailure />;
  if (outcome.value.length === 0) {
    return (
      <EmptyState
        title={t("emptyTitle")}
        body={t("emptyBody")}
        action={
          <Button asChild>
            <Link href={`${ROUTES.storageLayouts}/new`}>
              <Plus aria-hidden="true" className="size-4" />
              {t("newBuilding")}
            </Link>
          </Button>
        }
      />
    );
  }
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const buildings = outcome.value.filter(
    (building) =>
      (status === "ALL" || building.status === status) &&
      (normalizedSearch.length === 0 ||
        building.code.toLocaleLowerCase().includes(normalizedSearch) ||
        building.name.toLocaleLowerCase().includes(normalizedSearch)),
  );
  return (
    <div className="space-y-5">
      <StorageCatalogueFilters
        search={search}
        status={status}
        onSearchChange={onSearchChange}
        onStatusChange={onStatusChange}
      />
      {buildings.length === 0 ? (
        <EmptyState title={t("noMatches")} body={t("noMatchesBody")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {buildings.map((building) => (
            <Link
              key={building.buildingId}
              href={storageBuildingPath(building.buildingId)}
              className="group rounded-2xl border border-border bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <CompactBuildingModel building={building} />
                <StatusBadge
                  tone={statusTone(building.status)}
                  label={statusLabel(t, building.status)}
                />
              </div>
              <p className="mt-5 text-xs font-semibold tracking-[0.16em] text-muted uppercase">
                {building.code}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-text group-hover:text-accent">
                {building.name}
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
                <AreaOverview
                  grossAreaSqMm={building.grossAreaSqMm}
                  usableAreaSqMm={building.usableAreaSqMm}
                  storedFootprintAreaSqMm={building.storedFootprintAreaSqMm ?? 0}
                  heldFootprintAreaSqMm={building.heldFootprintAreaSqMm ?? 0}
                />
              </div>
            </Link>
          ))}
        </div>
      )}
      <Notice
        tone="muted"
        title={t("planningNotice")}
        body={t("planningNoticeBody")}
      />
    </div>
  );
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

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-text">{value}</dd>
    </div>
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const outcome = await create({
        warehouseId,
        requestId: requestId(),
        code: String(data.get("code") ?? ""),
        name: String(data.get("name") ?? ""),
        widthMm: millimetres(String(data.get("width") ?? "")),
        depthMm: millimetres(String(data.get("depth") ?? "")),
        defaultFloorHeightMm: millimetres(String(data.get("height") ?? "")),
        floorCount: Number(data.get("floors")),
      });
      if (!outcome.ok) setError(outcome.denial.code);
      else if (!outcome.value.written) setError(outcome.value.error.code);
      else router.push(storageBuildingPath(outcome.value.documentId));
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="grid gap-6 rounded-2xl border border-border bg-surface p-6 shadow-sm lg:grid-cols-[1fr_0.8fr]"
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
        {error === undefined ? null : (
          <div className="sm:col-span-2">
            <Notice tone="warning" title={storageErrorMessage(t, error)} />
          </div>
        )}
        <div className="flex gap-3 sm:col-span-2">
          <Button disabled={pending}>
            {pending ? t("creating") : t("create")}
          </Button>
          <Button variant="outline" asChild>
            <Link href={ROUTES.storageLayouts}>{t("back")}</Link>
          </Button>
        </div>
      </div>
      <div className="hidden min-h-80 items-center justify-center rounded-xl bg-[radial-gradient(circle_at_top,_var(--color-accent)_0,_transparent_55%)] p-8 lg:flex">
        <Building2
          className="size-40 text-accent/60"
          strokeWidth={1}
          aria-hidden="true"
        />
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  ...props
}: { readonly label: string; readonly name: string } & React.ComponentProps<
  typeof Input
>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
    </div>
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
  const { building, floors } = outcome.value;
  const placements = floors.flatMap((floor) =>
    floor.storageZones.flatMap((zone) => zone.placements),
  );
  const quickChangeFloor =
    floors.find((floor) => floor.storageZones.length > 0) ?? floors[0];
  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <BuildingModelWorkspace
          building={building}
          floors={floors}
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
      <aside className="grid items-start gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[.15em] text-muted uppercase">
                {building.code}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-text">
                {building.name}
              </h2>
            </div>
            <StatusBadge
              tone={statusTone(building.status)}
              label={statusLabel(t, building.status)}
            />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4">
            <Metric
              label={t("width")}
              value={`${metres(building.widthMm)} m`}
            />
            <Metric
              label={t("depth")}
              value={`${metres(building.depthMm)} m`}
            />
            <Metric
              label={t("totalHeight")}
              value={`${metres(building.totalHeightMm)} m`}
            />
          </dl>
        </section>
        {building.status === "ARCHIVED" ||
        quickChangeFloor === undefined ? null : (
          <Button className="w-full" variant="outline" asChild>
            <Link
              href={storageFloorPath(buildingId, quickChangeFloor.floorNumber)}
            >
              <Zap className="size-4" />
              {t("quickChange")}
            </Link>
          </Button>
        )}
        <Button className="w-full" asChild>
          <Link href={storageReviewPath(buildingId)}>{t("review")}</Link>
        </Button>
      </aside>
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmingImpact, setConfirmingImpact] = useState(false);
  const [buildingGeometryChanged, setBuildingGeometryChanged] = useState(false);

  async function saveDimensions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const geometryChanged =
      millimetres(String(data.get("width"))) !== building.widthMm ||
      millimetres(String(data.get("depth"))) !== building.depthMm ||
      millimetres(String(data.get("height"))) !== building.defaultFloorHeightMm;
    if (placements.length > 0 && geometryChanged) {
      setConfirmingImpact(true);
      setError(undefined);
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const result = await update({
        warehouseId,
        buildingId: building.buildingId,
        requestId: requestId(),
        expectedVersion: building.version,
        name: String(data.get("name") ?? building.name),
        widthMm: millimetres(String(data.get("width"))),
        depthMm: millimetres(String(data.get("depth"))),
        defaultFloorHeightMm: millimetres(String(data.get("height"))),
      });
      if (!result.ok) setError(result.denial.code);
      else if (!result.value.written) setError(result.value.error.code);
      else setConfirmingImpact(false);
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
      const result = await changeFloorCount({
        warehouseId,
        buildingId: building.buildingId,
        requestId: requestId(),
        expectedVersion: building.version,
        floorCount: Number(data.get("floorCount")),
      });
      if (!result.ok) setError(result.denial.code);
      else if (!result.value.written) setError(result.value.error.code);
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
          setBuildingGeometryChanged(
            millimetres(String(data.get("width"))) !== building.widthMm ||
              millimetres(String(data.get("depth"))) !== building.depthMm ||
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
          disabled={pending || (confirmingImpact && placements.length > 0)}
        >
          {pending
            ? t("saving")
            : confirmingImpact
              ? t("confirmChanges")
              : buildingGeometryChanged && placements.length > 0
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

export function BuildingModelWorkspace({
  building,
  floors,
  settingsAction,
}: {
  readonly building: StorageBuildingRow;
  readonly floors: readonly StorageFloorRow[];
  readonly settingsAction?: ReactNode;
}) {
  const t = useTranslations("StorageLayouts");
  const router = useRouter();
  const [view, setView] = useState<"storage" | "building">("storage");
  const [selectedFloorNumber, setSelectedFloorNumber] = useState(
    (
      floors.find((floor) =>
        floor.storageZones.some((zone) => zone.placements.length > 0),
      ) ??
      floors.find((floor) => floor.storageZones.length > 0) ??
      floors[0]
    )?.floorNumber ?? 1,
  );
  const selectedFloor =
    floors.find((floor) => floor.floorNumber === selectedFloorNumber) ??
    floors[0];
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wider text-muted">
            {building.code}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-text">
            {building.name}
          </h2>
          <p className="mt-1 text-xs text-muted">{t("mapSavedData")}</p>
        </div>
        <div className="flex items-center gap-2">
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
              onClick={() => setView("storage")}
            >
              {t("storageFloorView")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "building" ? "secondary" : "ghost"}
              aria-pressed={view === "building"}
              onClick={() => setView("building")}
            >
              {t("buildingModelView")}
            </Button>
          </div>
          {settingsAction}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Layers3 className="size-4 text-accent" />
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
                <button
                  type="button"
                  onClick={() => setSelectedFloorNumber(floor.floorNumber)}
                  aria-pressed={selected}
                  className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm text-text"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={selected ? "text-accent" : undefined}>
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
                </button>
                <Link
                  href={storageFloorPath(
                    building.buildingId,
                    floor.floorNumber,
                  )}
                  aria-label={t("editFloor", { floor: floor.floorNumber })}
                  title={t("editFloor", { floor: floor.floorNumber })}
                  className="grid w-11 shrink-0 place-items-center border-l border-border text-muted transition hover:bg-accent-surface hover:text-accent focus-visible:bg-accent-surface focus-visible:text-accent focus-visible:outline-none"
                >
                  <PencilLine className="size-4" />
                </Link>
              </div>
            );
          })}
        </div>
      </div>
      {view === "building" ? (
        <IsometricBuilding
          building={building}
          floors={floors}
          highlightedFloorNumber={
            selectedFloor?.floorNumber ?? selectedFloorNumber
          }
        />
      ) : selectedFloor ? (
        <FloorMap
          key={selectedFloor.floorId}
          floorNumber={selectedFloor.floorNumber}
          widthMm={selectedFloor.widthMm ?? building.widthMm}
          depthMm={selectedFloor.depthMm ?? building.depthMm}
          heightMm={selectedFloor.heightMm ?? building.defaultFloorHeightMm}
          baseWidthMm={building.widthMm}
          baseDepthMm={building.depthMm}
          baseLabel={t("buildingFootprint")}
          offsetXMm={selectedFloor.offsetXMm ?? 0}
          offsetYMm={selectedFloor.offsetYMm ?? 0}
          zones={selectedFloor.storageZones}
          blocks={selectedFloor.reservedBlocks}
          onEditZone={
            building.status !== "ARCHIVED"
              ? (zoneId) =>
                  router.push(
                    `${storageFloorPath(building.buildingId, selectedFloor.floorNumber)}?editZone=${encodeURIComponent(zoneId)}`,
                  )
              : undefined
          }
        />
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

type EditableBlock = Omit<StorageReservedBlockRow, "blockId"> & {
  readonly id: string;
};

function FloorForm({
  warehouseId,
  detail,
  floor,
}: {
  readonly warehouseId: string;
  readonly detail: Extract<StorageBuildingDetail, { found: true }>;
  readonly floor: StorageFloorRow;
}) {
  const t = useTranslations("StorageLayouts");
  const canManage = useCanManage();
  const editable = canManage && detail.building.status !== "ARCHIVED";
  const save = useMutation(storageLayoutRefs.saveFloor);
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
  const previousFloor = detail.floors.find(
    (candidate) => candidate.floorNumber === floor.floorNumber - 1,
  );
  const baseWidthMm = previousFloor?.widthMm ?? detail.building.widthMm;
  const baseDepthMm = previousFloor?.depthMm ?? detail.building.depthMm;
  const initialWidthMm = floor.widthMm ?? detail.building.widthMm;
  const initialDepthMm = floor.depthMm ?? detail.building.depthMm;
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
    width === "" ? detail.building.widthMm : millimetres(width);
  const actualDepth =
    depth === "" ? detail.building.depthMm : millimetres(depth);
  const actualHeight =
    height === "" ? detail.building.defaultFloorHeightMm : millimetres(height);
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
    readonly label: string;
    readonly xMm: number;
    readonly yMm: number;
    readonly widthMm: number;
    readonly depthMm: number;
  }) => [block.label, block.xMm, block.yMm, block.widthMm, block.depthMm];
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
  const placements = detail.floors.flatMap((candidate) =>
    candidate.storageZones.flatMap((zone) => zone.placements),
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editable || pending) return;
    if (placements.length > 0) {
      setConfirmingImpact(true);
      setMessage(undefined);
      return;
    }
    setPending(true);
    setMessage(undefined);
    try {
      const outcome = await save({
        warehouseId,
        buildingId: detail.building.buildingId,
        requestId: requestId(),
        expectedBuildingVersion: detail.building.version,
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
      });
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
        setConfirmingImpact(false);
        setMessage({ tone: "success", text: t("savedContinueToStorage") });
        requestAnimationFrame(() => {
          document
            .getElementById("storage-stacks-section")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="xl:col-span-2">
        <FloorPlan
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
          {...(editable ? { onPlacementChange: setPlacement } : {})}
          blocks={blocks}
          zones={floor.storageZones}
          onEditZone={
            editable && !hasUnsavedFloorChanges
              ? (zoneId) => setMapEditRequest({ zoneId, nonce: Date.now() })
              : undefined
          }
        />
      </div>
      <div className="min-w-0 space-y-6">
        {!canManage && <Notice tone="muted" title={t("layoutViewOnly")} />}

        {/*
         * Dimension overrides are the exception, not the everyday edit: a
         * floor inherits the building's footprint unless somebody says
         * otherwise. Collapsed with an "inherits" badge while untouched, so
         * the plan and zones stay the screen's subject.
         */}
        <CollapsibleSection
          label={t("dimensions")}
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
            disabled={!editable}
          />
          <OverrideField
            label={t("depth")}
            value={depth}
            onChange={setDepth}
            disabled={!editable}
          />
          <OverrideField
            label={t("height")}
            value={height}
            onChange={setHeight}
            disabled={!editable}
          />
        </CollapsibleSection>
        <div role="status" aria-atomic="true">
          <AreaOverview
            grossAreaSqMm={grossAreaSqMm}
            usableAreaSqMm={usableAreaSqMm}
                  {...storageFootprintUsage(floor.storageZones)}
          />
        </div>
        <ReservedBlocks
          editable={editable}
          blocks={blocks}
          setBlocks={setBlocks}
          floorWidthMm={actualWidth}
          floorDepthMm={actualDepth}
          floorHeightMm={actualHeight}
          zones={floor.storageZones}
        />
        <StorageZonesPanel
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
          blocked={hasUnsavedFloorChanges}
        />
        {message === undefined ? null : (
          <Notice tone={message.tone} title={message.text} />
        )}
      </div>
      <aside className="space-y-3">
        <section className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-xs font-semibold tracking-[.15em] text-muted uppercase">
            {detail.building.code}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-text">
            {t("floor", { floor: floor.floorNumber })}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {metres(actualWidth)} × {metres(actualDepth)} ×{" "}
            {metres(actualHeight)} m
          </p>
        </section>
        {confirmingImpact ? (
          <ChangeImpactSummary
            placements={placements}
            currentPlan={`${metres(initialWidthMm)} × ${metres(initialDepthMm)} × ${metres(floor.heightMm ?? detail.building.defaultFloorHeightMm)} m`}
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
          className="w-full"
          disabled={
            !editable ||
            pending ||
            !hasUnsavedFloorChanges ||
            (confirmingImpact && placements.length > 0)
          }
        >
          {pending
            ? t("saving")
            : confirmingImpact
              ? t("confirmChanges")
              : !hasUnsavedFloorChanges
                ? t("floorSaved")
                : detail.building.status === "ACTIVE" && placements.length > 0
                  ? t("reviewImpact")
                  : t("saveAndContinue")}
        </Button>
      </aside>
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
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        disabled={disabled}
        id={inputId}
        type="number"
        min="0.1"
        step="0.1"
        value={value}
        placeholder={t("inherits")}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function FloorPlan(
  props: Parameters<typeof FloorOffsetPlan>[0] & {
    readonly onEditZone?: ((zoneId: string) => void) | undefined;
  },
) {
  return (
    <FloorMap
      {...props}
      zones={props.zones ?? []}
      offsetEditor={
        props.onPlacementChange ? <FloorOffsetPlan {...props} /> : undefined
      }
    />
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
        <span>
          <i className="mr-2 inline-block size-3 rounded-sm bg-warning" />
          {t("unavailable")}
        </span>
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
        {blocks.map((block) => {
          const shape = [
            topPoint(block.xMm, block.yMm),
            topPoint(block.xMm + block.widthMm, block.yMm),
            topPoint(block.xMm + block.widthMm, block.yMm + block.depthMm),
            topPoint(block.xMm, block.yMm + block.depthMm),
          ];
          const labelPoint = topPoint(
            block.xMm + block.widthMm / 2,
            block.yMm + block.depthMm / 2,
          );
          return (
            <g key={block.id}>
              <polygon
                points={pointsAttribute(shape)}
                className="fill-warning/50 stroke-warning"
                strokeWidth="1.5"
              />
              <text
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-text text-[11px] font-semibold"
              >
                {block.label}
              </text>
            </g>
          );
        })}
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
                {zone.code.split("-").at(-1)} ·{" "}
                {uniqueStoragePallets(zone.placements).length}
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
        <g key={block.id}>
          <rect
            x={offsetXMm + block.xMm}
            y={offsetYMm + block.yMm}
            width={block.widthMm}
            height={block.depthMm}
            fill="url(#storage-reserved-hatch)"
            className="stroke-warning"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={offsetXMm + block.xMm + block.widthMm / 2}
            y={offsetYMm + block.yMm + block.depthMm / 2}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-warning font-semibold"
            style={{ fontSize: labelSize }}
          >
            {block.label}
          </text>
        </g>
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
            {zone.code.split("-").at(-1)} ·{" "}
            {uniqueStoragePallets(zone.placements).length}
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
}: {
  readonly blocks: readonly EditableBlock[];
  readonly setBlocks: (blocks: EditableBlock[]) => void;
  readonly floorWidthMm: number;
  readonly floorDepthMm: number;
  readonly floorHeightMm: number;
  readonly zones: readonly StorageZoneRow[];
  readonly editable?: boolean;
}) {
  const t = useTranslations("StorageLayouts");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string>();
  const [draft, setDraft] = useState({
    label: "",
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
      id: editingBlockId ?? requestId(),
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
                onPositionChange={({ xMm, yMm }) =>
                  setDraft((current) => ({
                    ...current,
                    x: String(metres(xMm)),
                    y: String(metres(yMm)),
                  }))
                }
              />
              <div className="grid content-start gap-4 sm:grid-cols-2">
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
                <h3 className="truncate font-semibold text-text">
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

const firstFreeStoragePosition = (
  floorWidthMm: number,
  floorDepthMm: number,
  widthMm: number,
  depthMm: number,
  areas: readonly {
    readonly xMm: number;
    readonly yMm: number;
    readonly widthMm: number;
    readonly depthMm: number;
  }[],
) => {
  const stepMm = 500;
  for (let yMm = 0; yMm + depthMm <= floorDepthMm; yMm += stepMm) {
    for (let xMm = 0; xMm + widthMm <= floorWidthMm; xMm += stepMm) {
      const candidate = { xMm, yMm, widthMm, depthMm };
      if (!areas.some((area) => rectanglesOverlap(candidate, area))) {
        return { xMm, yMm };
      }
    }
  }
  return { xMm: 0, yMm: 0 };
};

export function StorageZonesPanel({
  editRequest,
  warehouseId,
  buildingId,
  floorNumber,
  floorWidthMm,
  floorDepthMm,
  floorHeightMm,
  zones,
  reservedBlocks = [],
  layoutStatus = "DRAFT",
  blocked = false,
}: {
  readonly editRequest?:
    { readonly zoneId: string; readonly nonce: number } | undefined;
  readonly warehouseId: string;
  readonly buildingId: string;
  readonly floorNumber: number;
  readonly floorWidthMm: number;
  readonly floorDepthMm: number;
  readonly floorHeightMm: number;
  readonly zones: readonly StorageZoneRow[];
  readonly reservedBlocks?: readonly EditableBlock[];
  readonly layoutStatus?: StorageLayoutStatus;
  readonly blocked?: boolean;
}) {
  const t = useTranslations("StorageLayouts");
  const [search, setSearch] = useState("");
  const searchId = useId();
  const visibleZones = useMemo(() => {
    const words = search
      .normalize("NFKC")
      .toLocaleLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return zones.filter((zone) => {
      const text = [
        zone.label,
        zone.code,
        zone.qrValue,
        ...zone.positions.flatMap((position) => [
          position.label,
          position.code,
          position.qrValue,
        ]),
        ...zone.placements.flatMap((placement) => [
          placement.lpn,
          placement.positionCode ?? "",
        ]),
      ]
        .join(" ")
        .normalize("NFKC")
        .toLocaleLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [search, zones]);
  const canManage = useCanManage();
  const editable = canManage && layoutStatus !== "ARCHIVED";
  const createZone = useMutation(storageLayoutRefs.createZone);
  const updateZone = useMutation(storageLayoutRefs.updateZone);
  const archiveZone = useMutation(storageLayoutRefs.archiveZone);
  const [label, setLabel] = useState("");
  const [storageCondition, setStorageCondition] = useState("ANY");
  const [zoneX, setZoneX] = useState("0");
  const [zoneY, setZoneY] = useState("0");
  const [zoneWidth, setZoneWidth] = useState("2");
  const [zoneDepth, setZoneDepth] = useState("2");
  const [stackHeight, setStackHeight] = useState(String(metres(floorHeightMm)));
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<StorageZoneRow>();
  const followedAnchor = useRef<string | undefined>(undefined);
  useEffect(() => {
    const followAnchor = () => {
      const id = window.location.hash.slice(1);
      if (
        id !== "storage-stacks-section" &&
        !zones.some((zone) => id === `storage-zone-${zone.zoneId}`)
      )
        return;
      const target = document.getElementById(id);
      const key = `${warehouseId}:${buildingId}:${floorNumber}:${id}`;
      if (!target || followedAnchor.current === key) return;
      followedAnchor.current = key;
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: "start" });
    };
    // Floor data arrives after the browser's initial fragment navigation.
    followAnchor();
    const onHashChange = () => {
      followedAnchor.current = undefined;
      if (
        zones.some(
          (zone) => window.location.hash === `#storage-zone-${zone.zoneId}`,
        )
      )
        setSearch("");
      followAnchor();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [warehouseId, buildingId, floorNumber, zones, visibleZones]);
  const [confirmingImpact, setConfirmingImpact] = useState(false);
  const [pendingAction, setPendingAction] = useState<string>();
  const [message, setMessage] = useState<{
    readonly tone: "success" | "warning";
    readonly text: string;
  }>();
  const openedFromLink = useRef<string | number | undefined>(undefined);
  useEffect(() => {
    const requested =
      editRequest?.zoneId ??
      new URLSearchParams(window.location.search).get("editZone");
    const requestKey = editRequest?.nonce ?? requested;
    const zone = zones.find((item) => item.zoneId === requested);
    if (
      editable &&
      zone &&
      requestKey != null &&
      openedFromLink.current !== requestKey
    ) {
      openedFromLink.current = requestKey;
      setMessage(undefined);
      setConfirmingImpact(false);
      setEditingZone(zone);
      setLabel(zone.label);
      setStorageCondition(zone.storageCondition?.trim().toUpperCase() || "ANY");
      setZoneX(String(metres(zone.xMm)));
      setZoneY(String(metres(zone.yMm)));
      setZoneWidth(String(metres(zone.widthMm)));
      setZoneDepth(String(metres(zone.depthMm)));
      setStackHeight(String(metres(zone.maxStackHeightMm)));
      setCreateDialogOpen(true);
    }
  }, [editable, zones, editRequest]);
  const zoneDraft = {
    xMm: millimetres(zoneX),
    yMm: millimetres(zoneY),
    widthMm: millimetres(zoneWidth),
    depthMm: millimetres(zoneDepth),
  };
  const normalizedCondition = (condition: string | undefined) => {
    const normalized = condition?.trim().toUpperCase();
    return normalized === "ANY" ? "" : (normalized ?? "");
  };
  const occupiedChangeBlocked =
    editingZone !== undefined &&
    editingZone.placements.length > 0 &&
    (zoneDraft.xMm !== editingZone.xMm ||
      zoneDraft.yMm !== editingZone.yMm ||
      zoneDraft.widthMm !== editingZone.widthMm ||
      zoneDraft.depthMm !== editingZone.depthMm ||
      millimetres(stackHeight) !== editingZone.maxStackHeightMm ||
      normalizedCondition(storageCondition) !==
        normalizedCondition(editingZone.storageCondition));
  const otherZones =
    editingZone === undefined
      ? zones
      : zones.filter((zone) => zone.zoneId !== editingZone.zoneId);
  const storageDraftValid =
    zoneDraft.xMm >= 0 &&
    zoneDraft.yMm >= 0 &&
    zoneDraft.widthMm > 0 &&
    zoneDraft.depthMm > 0 &&
    millimetres(stackHeight) > 0 &&
    zoneDraft.xMm + zoneDraft.widthMm <= floorWidthMm &&
    zoneDraft.yMm + zoneDraft.depthMm <= floorDepthMm &&
    millimetres(stackHeight) <= floorHeightMm &&
    ![...reservedBlocks, ...otherZones].some((area) =>
      rectanglesOverlap(zoneDraft, area),
    );

  const startNewStorageZone = () => {
    if (!editable) return;
    const position = firstFreeStoragePosition(
      floorWidthMm,
      floorDepthMm,
      2_000,
      2_000,
      [...reservedBlocks, ...zones],
    );
    setEditingZone(undefined);
    setLabel("");
    setStorageCondition("ANY");
    setZoneX(String(metres(position.xMm)));
    setZoneY(String(metres(position.yMm)));
    setZoneWidth("2");
    setZoneDepth("2");
    setStackHeight(String(metres(floorHeightMm)));
    setConfirmingImpact(false);
    setMessage(undefined);
  };

  const startEditingStorageZone = (zone: StorageZoneRow) => {
    if (!editable) return;
    setEditingZone(zone);
    setLabel(zone.label);
    setStorageCondition(zone.storageCondition?.trim().toUpperCase() || "ANY");
    setZoneX(String(metres(zone.xMm)));
    setZoneY(String(metres(zone.yMm)));
    setZoneWidth(String(metres(zone.widthMm)));
    setZoneDepth(String(metres(zone.depthMm)));
    setStackHeight(String(metres(zone.maxStackHeightMm)));
    setConfirmingImpact(false);
    setMessage(undefined);
    setCreateDialogOpen(true);
  };

  const saveStorageZone = async () => {
    if (!editable) return;
    if (occupiedChangeBlocked) {
      setConfirmingImpact(true);
      return;
    }
    const isEditing = editingZone !== undefined;
    setPendingAction(isEditing ? "update" : "create");
    setMessage(undefined);
    try {
      const draft = {
        warehouseId,
        requestId: requestId(),
        label: label || t("newStorageZoneLabel", { number: zones.length + 1 }),
        xMm: millimetres(zoneX),
        yMm: millimetres(zoneY),
        widthMm: millimetres(zoneWidth),
        depthMm: millimetres(zoneDepth),
        maxStackHeightMm: millimetres(stackHeight),
        storageCondition: storageCondition === "ANY" ? "" : storageCondition,
      };
      const outcome = isEditing
        ? await updateZone({
            ...draft,
            zoneId: editingZone.zoneId,
            ...(confirmingImpact ? { confirmOccupiedChange: true } : {}),
          })
        : await createZone({ ...draft, buildingId, floorNumber });
      if (!outcome.ok) {
        setMessage({
          tone: "warning",
          text: storageErrorMessage(t, outcome.denial.code),
        });
      } else if (!outcome.value.written) {
        setMessage({
          tone: "warning",
          text: storageErrorMessage(t, outcome.value.error.code),
        });
      } else {
        setLabel("");
        setConfirmingImpact(false);
        setCreateDialogOpen(false);
        setEditingZone(undefined);
        setMessage({
          tone: "success",
          text: t(isEditing ? "storageZoneUpdated" : "storageZoneCreated"),
        });
      }
    } finally {
      setPendingAction(undefined);
    }
  };

  const removeStorageZone = async (zone: StorageZoneRow) => {
    if (!editable) return;
    setPendingAction(zone.zoneId);
    setMessage(undefined);
    try {
      const outcome = await archiveZone({
        warehouseId,
        zoneId: zone.zoneId,
        requestId: requestId(),
      });
      if (!outcome.ok) {
        const code = outcome.denial.code;
        setMessage({ tone: "warning", text: storageErrorMessage(t, code) });
      } else if (!outcome.value.written) {
        const code = outcome.value.error.code;
        setMessage({ tone: "warning", text: storageErrorMessage(t, code) });
      } else {
        setMessage({ tone: "success", text: t("storageZoneArchived") });
      }
    } finally {
      setPendingAction(undefined);
    }
  };

  return (
    <section
      id="storage-stacks-section"
      tabIndex={-1}
      aria-label={t("storageZones")}
      className="min-w-0 scroll-mt-20 rounded-2xl border border-border bg-surface p-5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-success-surface text-success">
            <QrCode className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-text">{t("storageZones")}</h2>
              <span className="rounded-md bg-background px-2 py-0.5 text-xs text-muted tabular-nums">
                {zones.length}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">{t("storageZonesHelp")}</p>
          </div>
        </div>
        <Dialog
          open={createDialogOpen && editable}
          onOpenChange={(open) => {
            if (open && !editable) return;
            setCreateDialogOpen(open);
            if (open) setMessage(undefined);
            else {
              setEditingZone(undefined);
              setConfirmingImpact(false);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label={t("addStorageZone")}
              title={t("addStorageZone")}
              className="shrink-0 px-3"
              onClick={startNewStorageZone}
              disabled={!editable || blocked}
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">{t("addStorageZone")}</span>
            </Button>
          </DialogTrigger>
          <DialogContent closeLabel={t("closeDialog")} className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>
                {t(
                  editingZone === undefined
                    ? "addStorageZoneTitle"
                    : "editStorageZoneTitle",
                )}
              </DialogTitle>
              <DialogDescription>
                {t(
                  editingZone === undefined
                    ? "addStorageZoneDescription"
                    : "editStorageZoneDescription",
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.05fr)_minmax(19rem,0.95fr)]">
              <StorageZoneDraftPreview
                floorWidthMm={floorWidthMm}
                floorDepthMm={floorDepthMm}
                floorHeightMm={floorHeightMm}
                zoneX={zoneX}
                zoneY={zoneY}
                zoneWidth={zoneWidth}
                zoneDepth={zoneDepth}
                stackHeight={stackHeight}
                zones={otherZones}
                {...(editingZone ? { editingZone } : {})}
                reservedBlocks={reservedBlocks}
                onPositionChange={({ xMm, yMm }) => {
                  setZoneX(String(metres(xMm)));
                  setZoneY(String(metres(yMm)));
                }}
              />
              <div className="grid content-start gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="new-storage-zone-label">
                    {t("zoneLabel")}
                  </Label>
                  <Input
                    id="new-storage-zone-label"
                    className="mt-2"
                    value={label}
                    placeholder={t("newStorageZoneLabel", {
                      number: zones.length + 1,
                    })}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </div>
                {[
                  ["x", zoneX, setZoneX, 0, floorWidthMm],
                  ["y", zoneY, setZoneY, 0, floorDepthMm],
                  ["zoneWidth", zoneWidth, setZoneWidth, 0.1, floorWidthMm],
                  ["zoneDepth", zoneDepth, setZoneDepth, 0.1, floorDepthMm],
                ].map(([key, value, setValue, min, max]) => (
                  <div key={String(key)}>
                    <Label htmlFor={`new-storage-zone-${String(key)}`}>
                      {t(key as "x" | "y" | "zoneWidth" | "zoneDepth")}
                    </Label>
                    <Input
                      id={`new-storage-zone-${String(key)}`}
                      className="mt-2"
                      type="number"
                      min={Number(min)}
                      max={metres(Number(max))}
                      step="0.1"
                      value={String(value)}
                      onChange={(event) =>
                        (setValue as (value: string) => void)(
                          event.target.value,
                        )
                      }
                    />
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <Label htmlFor="new-storage-zone-condition">
                    {t("storageCondition")}
                  </Label>
                  <SelectControl
                    id="new-storage-zone-condition"
                    className="mt-2 w-full"
                    value={storageCondition}
                    onValueChange={setStorageCondition}
                    placeholder={t("storageConditionUnknown")}
                    emptyLabel={t("storageConditionUnknown")}
                    options={[
                      { value: "ANY", label: t("storageConditionUnknown") },
                      { value: "DRY", label: t("storageConditionDry") },
                      { value: "COOL", label: t("storageConditionCool") },
                      ...(["ANY", "DRY", "COOL"].includes(storageCondition)
                        ? []
                        : [
                            {
                              value: storageCondition,
                              label: storageCondition,
                            },
                          ]),
                    ]}
                  />
                  <p className="mt-2 text-xs text-muted">
                    {t("storageConditionHelp")}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="new-storage-zone-height">
                    {t("maxStackHeight")}
                  </Label>
                  <Input
                    id="new-storage-zone-height"
                    className="mt-2"
                    type="number"
                    min="0.1"
                    max={metres(floorHeightMm)}
                    step="0.1"
                    value={stackHeight}
                    onChange={(event) => setStackHeight(event.target.value)}
                  />
                </div>
              </div>
            </div>
            {message === undefined ? null : (
              <Notice tone={message.tone} title={message.text} />
            )}
            {confirmingImpact && editingZone !== undefined ? (
              <ChangeImpactSummary
                placements={editingZone.placements}
                currentPlan={`${metres(editingZone.widthMm)} × ${metres(editingZone.depthMm)} × ${metres(editingZone.maxStackHeightMm)} m`}
                proposedPlan={`${metres(zoneDraft.widthMm)} × ${metres(zoneDraft.depthMm)} × ${metres(millimetres(stackHeight))} m`}
              />
            ) : null}
            <DialogFooter>
              {confirmingImpact ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmingImpact(false)}
                >
                  {t("backToEdit")}
                </Button>
              ) : (
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    {t("cancel")}
                  </Button>
                </DialogClose>
              )}
              <Button
                type="button"
                onClick={() => {
                  if (occupiedChangeBlocked) {
                    setConfirmingImpact(true);
                    return;
                  }
                  void saveStorageZone();
                }}
                disabled={
                  pendingAction !== undefined ||
                  !editable ||
                  blocked ||
                  !storageDraftValid ||
                  (confirmingImpact && occupiedChangeBlocked)
                }
              >
                {editingZone === undefined ? (
                  <Plus className="size-4" />
                ) : confirmingImpact ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <PencilLine className="size-4" />
                )}
                {pendingAction === "create"
                  ? t("creating")
                  : pendingAction === "update"
                    ? t("updating")
                    : confirmingImpact
                      ? t("confirmChanges")
                      : occupiedChangeBlocked
                        ? t("reviewImpact")
                        : t(
                            editingZone === undefined
                              ? "createStorageZone"
                              : "saveStorageZoneChanges",
                          )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {blocked ? (
        <div className="mt-4">
          <Notice
            tone="accent"
            title={t("saveReservedBeforeStorage")}
            body={t("saveReservedBeforeStorageHelp")}
          />
        </div>
      ) : layoutStatus === "ACTIVE" && editable ? (
        <p
          className="mt-4 flex items-start gap-2 text-xs text-muted"
          title={t("quickChangeActiveHelp")}
        >
          <Zap className="size-4 shrink-0 text-success" aria-hidden="true" />
          <span>
            {t("quickChangeActive")}{" "}
            <span className="sr-only">{t("quickChangeActiveHelp")}</span>
          </span>
        </p>
      ) : !editable ? (
        <div className="mt-4">
          <Notice
            tone="muted"
            title={t(canManage ? "archivedLayoutReadOnly" : "layoutViewOnly")}
          />
        </div>
      ) : null}

      <div className="relative mt-4">
        <Label htmlFor={searchId} className="sr-only">
          {t("searchStorageSpots")}
        </Label>
        <Search
          className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted"
          aria-hidden="true"
        />
        <Input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          placeholder={t("searchStorageSpotsPlaceholder")}
          className="pr-11 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {search && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute top-0 right-0 size-11 p-0"
            aria-label={t("clearSpotSearch")}
            onClick={() => {
              setSearch("");
              document.getElementById(searchId)?.focus();
            }}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      <p role="status" className="mt-2 text-xs text-muted">
        {t("spotSearchCount", {
          count: visibleZones.length,
          total: zones.length,
        })}
      </p>
      {visibleZones.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <Search
            className="mx-auto mb-2 size-5 text-muted"
            aria-hidden="true"
          />
          <p className="font-medium">
            {t(zones.length ? "noMatchingSpots" : "noStorageSpots")}
          </p>
          <p className="mt-1 text-sm text-muted">
            {t(zones.length ? "noMatchingSpotsHelp" : "noStorageSpotsHelp")}
          </p>
          {search && (
            <Button
              type="button"
              variant="ghost"
              className="mt-2"
              onClick={() => setSearch("")}
            >
              {t("clearSpotSearch")}
            </Button>
          )}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {visibleZones.map((zone) => {
          const distinctPositions = zone.positions.filter(
            (position) => position.qrValue !== zone.qrValue,
          );
          return (
            <article
              key={zone.zoneId}
              id={`storage-zone-${zone.zoneId}`}
              tabIndex={-1}
              aria-label={`${zone.label} · ${zone.code}`}
              className="min-w-0 scroll-mt-20 rounded-xl border border-border bg-background p-4 outline-none target:border-accent target:ring-1 target:ring-accent focus-visible:ring-2 focus-visible:ring-accent"
            >
              <div className="flex items-start gap-3">
                <div className="grid size-24 shrink-0 place-items-center self-start rounded-lg bg-white p-2">
                  <QRCodeSVG
                    value={zone.qrValue}
                    size={80}
                    className="block"
                    level="M"
                    aria-label={t("qrForZone", { code: zone.code })}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold break-words text-text">
                    {zone.label}
                  </h3>
                  <p className="mt-1 font-mono text-xs break-all text-muted">
                    {zone.code}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {metres(zone.widthMm)} × {metres(zone.depthMm)} m ·{" "}
                    {metres(zone.maxStackHeightMm)} m
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pendingAction !== undefined || !editable}
                      onClick={() => startEditingStorageZone(zone)}
                      aria-label={t("editStorageZone", { label: zone.label })}
                      title={t("editStorageZone", { label: zone.label })}
                      className="size-10 bg-transparent p-0 hover:border-accent hover:bg-transparent disabled:bg-transparent"
                    >
                      <PencilLine className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pendingAction !== undefined || !editable}
                      onClick={() => removeStorageZone(zone)}
                      aria-label={t("archiveZone")}
                      title={`${t("archiveZone")} · ${zone.label}`}
                      className="size-10 p-0"
                    >
                      <Archive className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
              <details
                className="mt-3 border-t border-border pt-3"
                open={
                  search.trim() && distinctPositions.length > 0
                    ? true
                    : undefined
                }
              >
                <summary className="cursor-pointer text-xs font-medium text-accent focus-visible:outline-2 focus-visible:outline-accent">
                  {t("spotLabels", { count: distinctPositions.length + 1 })}
                </summary>
                <code className="mt-2 block text-xs break-all text-muted">
                  {zone.qrValue}
                </code>
                {distinctPositions.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {distinctPositions.map((position) => (
                      <li
                        key={position.locationId}
                        className="flex items-center gap-3 rounded-lg border border-border p-2"
                      >
                        <div className="grid size-16 shrink-0 place-items-center rounded bg-white p-1">
                          <QRCodeSVG
                            value={position.qrValue}
                            size={56}
                            className="block"
                            aria-label={t("qrForZone", { code: position.code })}
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium break-words">
                            {position.label}
                          </p>
                          <p className="text-xs break-all text-muted">
                            {position.code}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
              {zone.placements.length === 0 && (
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
                  {t("noPalletsAtSpot")}
                </p>
              )}
              {zone.placements.length > 0 && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-xs font-semibold text-muted">
                    {t("palletsAtLocation", {
                      count: uniqueStoragePallets(zone.placements).length,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {t("heldFootprintArea", {
                      area: (
                        occupiedStorageFootprintAreaSqMm(zone.placements) /
                        1_000_000
                      ).toLocaleString(undefined, { maximumFractionDigits: 3 }),
                    })}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {zone.placements.map((placement) => (
                      <li
                        key={placement.placementId}
                        className="rounded-lg border border-border p-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Link
                            href={palletPath(placement.handlingUnitId)}
                            className="min-w-0 text-sm font-semibold break-all text-accent underline-offset-4 hover:underline"
                          >
                            {placement.lpn}
                          </Link>
                          <span
                            className={
                              placement.status === "RESERVED" ||
                              placement.moveState === "IN_TRANSIT"
                                ? "rounded-full border border-warning/50 px-2 py-0.5 text-xs text-warning"
                                : "rounded-full border border-success/50 px-2 py-0.5 text-xs text-success"
                            }
                          >
                            {t(
                              placement.moveRole === "TARGET"
                                ? "placementMoveTarget"
                                : placement.moveRole === "SOURCE"
                                  ? placement.moveState === "IN_TRANSIT"
                                    ? "placementMoveInTransit"
                                    : "placementMoveSource"
                                  : placement.status === "RESERVED"
                                    ? "placementReserved"
                                    : "placementStored",
                            )}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                          <div className="min-w-0">
                            {placement.positionCode && (
                              <p className="mt-1 font-mono text-xs break-all text-muted">
                                {placement.positionCode}
                              </p>
                            )}
                            {placement.xMm !== undefined &&
                              placement.yMm !== undefined && (
                                <p className="mt-1 text-xs text-muted tabular-nums">
                                  X {metres(placement.xMm)} m · Y{" "}
                                  {metres(placement.yMm)} m · Z{" "}
                                  {metres(placement.zMm ?? 0)} m
                                </p>
                              )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="size-10 bg-transparent p-0 hover:border-accent hover:bg-transparent"
                            >
                              <Link
                                href={palletPath(placement.handlingUnitId)}
                                aria-label={t("openSpotPallet", {
                                  lpn: placement.lpn,
                                })}
                                title={t("openSpotPallet", {
                                  lpn: placement.lpn,
                                })}
                              >
                                <Eye className="size-4" />
                              </Link>
                            </Button>
                            {canManage &&
                              (placement.status === "STORED" ||
                                placement.moveState !== undefined) && (
                                <Button
                                  asChild
                                  variant="outline"
                                  size="sm"
                                  className="size-10 bg-transparent p-0 hover:border-accent hover:bg-transparent"
                                >
                                  <Link
                                    href={`${palletPath(placement.handlingUnitId)}/move`}
                                    aria-label={t(
                                      placement.moveState
                                        ? "continueSpotPalletMove"
                                        : "moveSpotPallet",
                                      { lpn: placement.lpn },
                                    )}
                                    title={t(
                                      placement.moveState
                                        ? "continueSpotPalletMove"
                                        : "moveSpotPallet",
                                      { lpn: placement.lpn },
                                    )}
                                  >
                                    <ArrowRightLeft className="size-4" />
                                  </Link>
                                </Button>
                              )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {message === undefined || createDialogOpen ? null : (
        <div className="mt-4">
          <Notice tone={message.tone} title={message.text} />
        </div>
      )}
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
  const outcome = useBuilding(warehouseId, buildingId);
  const activate = useMutation(storageLayoutRefs.activate);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (outcome === undefined) return <LoadingCard />;
  if (!outcome.ok) return <QueryFailure />;
  if (!outcome.value.found)
    return <Notice tone="warning" title={t("notFound")} />;
  const { building, floors } = outcome.value;
  const storageStackCount = floors.reduce(
    (total, floor) => total + floor.storageZones.length,
    0,
  );
  const quickChangeFloor =
    floors.find((floor) => floor.storageZones.length > 0) ?? floors[0];
  async function submit() {
    setPending(true);
    setError(undefined);
    try {
      const result = await activate({
        warehouseId,
        buildingId,
        requestId: requestId(),
        expectedVersion: building.version,
      });
      if (!result.ok) setError(result.denial.code);
      else if (!result.value.written) setError(result.value.error.code);
      else router.push(storageBuildingPath(buildingId));
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
        {building.status === "ARCHIVED" ||
        quickChangeFloor === undefined ? null : (
          <Button className="w-full" variant="outline" asChild>
            <Link
              href={storageFloorPath(buildingId, quickChangeFloor.floorNumber)}
            >
              <Zap className="size-4" />
              {t("quickChange")}
            </Link>
          </Button>
        )}
        {building.status === "DRAFT" ? (
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
