"use client";

import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Boxes,
  Layers3,
  PencilLine,
  Plus,
  QrCode,
  Ruler,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { QueryGate } from "@/components/system/QueryGate";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Link, useRouter } from "@/i18n/navigation";
import {
  storageBuildingPath,
  storageFloorPath,
  storageReviewPath,
  ROUTES,
} from "@/lib/navigation";
import {
  listHandlingUnitsRef,
  type HandlingUnitRow,
} from "@/lib/convex/masterDataApi";
import {
  storageLayoutRefs,
  type StorageBuildingDetail,
  type StorageBuildingRow,
  type StorageFloorRow,
  type StorageLayoutStatus,
  type StorageReservedBlockRow,
  type StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";
import {
  buildIsometricBuilding,
  pointsAttribute,
  projectIsometricPoint,
  unprojectIsometricDelta,
} from "@/lib/storageLayouts/isometricGeometry";

const metres = (millimetres: number) => millimetres / 1_000;
const millimetres = (value: string) => Math.round(Number(value) * 1_000);
const squareMetres = (area: number) => area / 1_000_000;
const requestId = () => crypto.randomUUID();

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

export function StorageBuildingCatalogue() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => <CatalogueContent warehouseId={warehouseId} />}
    </QueryGate>
  );
}

function CatalogueContent({ warehouseId }: { readonly warehouseId: string }) {
  const t = useTranslations("StorageLayouts");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StorageLayoutStatus | "ALL">("ALL");
  const outcome = useQuery(storageLayoutRefs.list, {
    warehouseId,
    ...(status === "ALL" ? {} : { status }),
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
      normalizedSearch.length === 0 ||
      building.code.toLocaleLowerCase().includes(normalizedSearch) ||
      building.name.toLocaleLowerCase().includes(normalizedSearch),
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t("search")}</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("search")}
            className="pl-10"
          />
        </label>
        <label>
          <span className="sr-only">{t("statusFilter")}</span>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as StorageLayoutStatus | "ALL")
            }
            className="min-h-touch rounded-md border border-input bg-surface px-3 text-sm text-text outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="ALL">{t("allStatuses")}</option>
            <option value="DRAFT">{t("draft")}</option>
            <option value="ACTIVE">{t("active")}</option>
            <option value="ARCHIVED">{t("archived")}</option>
          </select>
        </label>
      </div>
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
                <Metric
                  label={t("usableArea")}
                  value={`${squareMetres(building.usableAreaSqMm).toLocaleString()} m²`}
                />
                <Metric
                  label={t("available")}
                  value={`${Math.round((building.usableAreaSqMm / building.grossAreaSqMm) * 100)}%`}
                />
              </dl>
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
            <Notice tone="warning" title={t("writeError", { code: error })} />
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
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <BuildingModelWorkspace
          building={building}
          floors={floors}
          settingsAction={
            building.status === "DRAFT" ? (
              <BuildingSettingsSheet
                warehouseId={warehouseId}
                building={building}
              />
            ) : undefined
          }
        />
      </div>
      <aside className="space-y-4">
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
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-5">
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
            <Metric label={t("floors")} value={String(building.floorCount)} />
          </dl>
        </section>
        <CapacitySummary building={building} />
        <Button className="w-full" asChild>
          <Link href={storageReviewPath(buildingId)}>{t("review")}</Link>
        </Button>
        <Button className="w-full" variant="outline" asChild>
          <Link href={ROUTES.storageLayouts}>
            <ArrowLeft className="size-4" />
            {t("back")}
          </Link>
        </Button>
      </aside>
    </div>
  );
}

export function BuildingSettingsSheet({
  warehouseId,
  building,
}: {
  readonly warehouseId: string;
  readonly building: StorageBuildingRow;
}) {
  const t = useTranslations("StorageLayouts");
  return (
    <Sheet>
      <SheetTrigger asChild>
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
      </SheetTrigger>
      <SheetContent
        side="right"
        closeLabel={t("closeSettings")}
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border px-6 py-5 pr-16">
          <SheetTitle>{t("dimensions")}</SheetTitle>
          <SheetDescription>{t("settingsDescription")}</SheetDescription>
        </SheetHeader>
        <div className="p-6">
          <BuildingSettings warehouseId={warehouseId} building={building} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BuildingSettings({
  warehouseId,
  building,
}: {
  readonly warehouseId: string;
  readonly building: StorageBuildingRow;
}) {
  const t = useTranslations("StorageLayouts");
  const update = useMutation(storageLayoutRefs.update);
  const changeFloorCount = useMutation(storageLayoutRefs.changeFloorCount);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function saveDimensions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
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
      <form onSubmit={saveDimensions} className="grid gap-4">
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
        <Button size="default" disabled={pending}>
          {t("saveBuilding")}
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
          <Notice tone="warning" title={t("writeError", { code: error })} />
        </div>
      )}
    </div>
  );
}

function CapacitySummary({
  building,
}: {
  readonly building: StorageBuildingRow;
}) {
  const t = useTranslations("StorageLayouts");
  const usablePercent =
    building.grossAreaSqMm === 0
      ? 0
      : Math.round((building.usableAreaSqMm / building.grossAreaSqMm) * 100);
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-semibold text-text">{t("capacity")}</h2>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-warning/20">
        <div
          className="h-full rounded-full bg-success"
          style={{ width: `${usablePercent}%` }}
        />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4">
        <Metric
          label={t("grossArea")}
          value={`${squareMetres(building.grossAreaSqMm).toLocaleString()} m²`}
        />
        <Metric
          label={t("usableArea")}
          value={`${squareMetres(building.usableAreaSqMm).toLocaleString()} m²`}
        />
        <Metric
          label={t("reservedArea")}
          value={`${squareMetres(building.reservedAreaSqMm).toLocaleString()} m²`}
        />
        <Metric label={t("available")} value={`${usablePercent}%`} />
      </dl>
    </section>
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
  const [selectedFloorNumber, setSelectedFloorNumber] = useState(
    floors.at(-1)?.floorNumber ?? 1,
  );
  return (
    <div className="grid overflow-hidden rounded-2xl border border-border bg-surface shadow-sm lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="border-b border-border p-4 lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Layers3 className="size-4 text-accent" />
          {t("floors")}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
          {[...floors].reverse().map((floor) => {
            const selected = selectedFloorNumber === floor.floorNumber;
            return (
              <div
                key={floor.floorId}
                className={`flex min-w-0 overflow-hidden rounded-xl border transition ${selected ? "border-accent bg-accent/10" : "border-border hover:border-accent/70"}`}
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
                  className="grid w-11 shrink-0 place-items-center border-l border-border text-muted transition hover:bg-accent/10 hover:text-accent focus-visible:bg-accent/10 focus-visible:text-accent focus-visible:outline-none"
                >
                  <PencilLine className="size-4" />
                </Link>
              </div>
            );
          })}
        </div>
      </div>
      <IsometricBuilding
        building={building}
        floors={floors}
        highlightedFloorNumber={selectedFloorNumber}
        action={settingsAction}
      />
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
  const save = useMutation(storageLayoutRefs.saveFloor);
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
  const grossAreaSqMm = actualWidth * actualDepth;
  const reservedAreaSqMm = blocks.reduce(
    (total, block) => total + block.widthMm * block.depthMm,
    0,
  );
  const usableAreaSqMm = Math.max(0, grossAreaSqMm - reservedAreaSqMm);
  const availablePercent =
    grossAreaSqMm === 0
      ? 0
      : Math.round((usableAreaSqMm / grossAreaSqMm) * 1_000) / 10;
  async function submit(event: FormEvent) {
    event.preventDefault();
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
          text: t("writeError", { code: outcome.denial.code }),
        });
      else if (!outcome.value.written)
        setMessage({
          tone: "warning",
          text: t("writeError", { code: outcome.value.error.code }),
        });
      else setMessage({ tone: "success", text: t("saved") });
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]"
    >
      <div className="space-y-6">
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
          onPlacementChange={setPlacement}
          blocks={blocks}
          zones={floor.storageZones}
        />
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Ruler className="size-5 text-accent" />
            <h2 className="font-semibold text-text">{t("dimensions")}</h2>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <OverrideField
              label={t("width")}
              value={width}
              onChange={setWidth}
            />
            <OverrideField
              label={t("depth")}
              value={depth}
              onChange={setDepth}
            />
            <OverrideField
              label={t("height")}
              value={height}
              onChange={setHeight}
            />
          </div>
        </section>
        <ReservedBlocks blocks={blocks} setBlocks={setBlocks} />
        <StorageZonesPanel
          warehouseId={warehouseId}
          buildingId={detail.building.buildingId}
          floorNumber={floor.floorNumber}
          floorWidthMm={actualWidth}
          floorDepthMm={actualDepth}
          floorHeightMm={actualHeight}
          zones={floor.storageZones}
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
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" />
            <h2 className="font-semibold text-text">{t("capacity")}</h2>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-warning/20">
            <div
              className="h-full rounded-full bg-success transition-[width]"
              style={{
                width: `${Math.max(0, Math.min(100, availablePercent))}%`,
              }}
            />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4">
            <Metric
              label={t("grossArea")}
              value={`${squareMetres(grossAreaSqMm).toLocaleString()} m²`}
            />
            <Metric
              label={t("reservedArea")}
              value={`${squareMetres(reservedAreaSqMm).toLocaleString()} m²`}
            />
            <Metric
              label={t("usableArea")}
              value={`${squareMetres(usableAreaSqMm).toLocaleString()} m²`}
            />
            <Metric label={t("available")} value={`${availablePercent}%`} />
          </dl>
        </section>
        <Button className="w-full" disabled={pending}>
          {pending ? t("saving") : t("saveFloor")}
        </Button>
        <Button className="w-full" variant="outline" asChild>
          <Link href={storageBuildingPath(detail.building.buildingId)}>
            <ArrowLeft className="size-4" />
            {t("editBuilding")}
          </Link>
        </Button>
      </aside>
    </form>
  );
}

function OverrideField({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const inputId = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
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

export function FloorPlan({
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
  readonly onPlacementChange: (placement: {
    readonly xMm: number;
    readonly yMm: number;
  }) => void;
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
        <div
          role="group"
          aria-label={t("viewMode")}
          className="inline-flex rounded-lg border border-border bg-background p-1"
        >
          <button
            type="button"
            aria-pressed={view === "3d"}
            onClick={() => setView("3d")}
            className="min-h-10 rounded-md px-4 text-sm font-medium text-muted transition hover:text-text aria-pressed:bg-accent/15 aria-pressed:text-accent"
          >
            {t("threeDView")}
          </button>
          <button
            type="button"
            aria-pressed={view === "plan"}
            onClick={() => setView("plan")}
            className="min-h-10 rounded-md px-4 text-sm font-medium text-muted transition hover:text-text aria-pressed:bg-accent/15 aria-pressed:text-accent"
          >
            {t("planView")}
          </button>
        </div>
      </figcaption>
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
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs">
        <span className="font-medium text-text">
          {t("positionOn", { base: baseLabel })}
        </span>
        <span className="text-muted tabular-nums">
          X {metres(offsetXMm)} m · Y {metres(offsetYMm)} m
        </span>
      </div>
      <p className="mt-2 text-xs text-muted">{t("dragHint")}</p>
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
        <span>
          <i className="mr-2 inline-block size-3 rounded-sm bg-success/30" />
          {t("available")}
        </span>
        <span>
          <i className="mr-2 inline-block size-3 rounded-sm bg-warning/50" />
          {t("unavailable")}
        </span>
        <span>
          <i className="mr-2 inline-block size-3 rounded-sm border border-success bg-success/25" />
          {t("storageZones")}
        </span>
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
  readonly onPlacementChange: (placement: {
    readonly xMm: number;
    readonly yMm: number;
  }) => void;
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
      className="h-[28rem] w-full rounded-xl border border-accent/30 bg-background"
      onPointerMove={(event) => {
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
        role="button"
        tabIndex={0}
        aria-label={t("dragFloor", { floor: floorNumber })}
        className="cursor-grab outline-none active:cursor-grabbing focus-visible:[&>polygon]:stroke-text"
        style={{ touchAction: "none" }}
        onPointerDown={(event) => {
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
                {zone.code.split("-").at(-1)} · {zone.placements.length}
              </text>
            </g>
          );
        })}
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
      className="h-[28rem] w-full rounded-xl border border-accent/30 bg-background"
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
        strokeDasharray={`${padding / 5} ${padding / 5}`}
        strokeWidth={Math.max(30, drawingWidth / 900)}
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={offsetXMm}
        y={offsetYMm}
        width={widthMm}
        height={depthMm}
        className="fill-accent/15 stroke-accent"
        strokeWidth={Math.max(40, drawingWidth / 700)}
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
            strokeWidth={Math.max(40, drawingWidth / 700)}
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
            {zone.code.split("-").at(-1)} · {zone.placements.length}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ReservedBlocks({
  blocks,
  setBlocks,
}: {
  readonly blocks: readonly EditableBlock[];
  readonly setBlocks: (blocks: EditableBlock[]) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const patchBlock = (
    index: number,
    field: keyof EditableBlock,
    value: string,
  ) =>
    setBlocks(
      blocks.map((block, current) =>
        current === index
          ? {
              ...block,
              [field]: field === "label" ? value : millimetres(value),
            }
          : block,
      ),
    );
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-text">{t("reservedZones")}</h2>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setBlocks([
              ...blocks,
              {
                id: requestId(),
                label: `Zone ${blocks.length + 1}`,
                xMm: 0,
                yMm: 0,
                widthMm: 1_000,
                depthMm: 1_000,
              },
            ])
          }
        >
          <Plus className="size-4" />
          {t("addZone")}
        </Button>
      </div>
      <div className="mt-5 space-y-3">
        {blocks.map((block, index) => (
          <div
            key={block.id}
            className="grid gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-6"
          >
            <div className="sm:col-span-2">
              <Label htmlFor={`storage-zone-${block.id}-label`}>
                {t("zoneLabel")}
              </Label>
              <Input
                id={`storage-zone-${block.id}-label`}
                className="mt-2"
                value={block.label}
                onChange={(event) =>
                  patchBlock(index, "label", event.target.value)
                }
              />
            </div>
            {(
              [
                ["x", "xMm"],
                ["y", "yMm"],
                ["zoneWidth", "widthMm"],
                ["zoneDepth", "depthMm"],
              ] as const
            ).map(([label, field]) => (
              <div key={field}>
                <Label htmlFor={`storage-zone-${block.id}-${field}`}>
                  {t(label)}
                </Label>
                <Input
                  id={`storage-zone-${block.id}-${field}`}
                  className="mt-2"
                  type="number"
                  min="0"
                  step="0.1"
                  value={metres(block[field])}
                  onChange={(event) =>
                    patchBlock(index, field, event.target.value)
                  }
                />
              </div>
            ))}
            <div className="flex items-end sm:col-span-6">
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setBlocks(blocks.filter((_, current) => current !== index))
                }
              >
                <Trash2 className="size-4" />
                {t("remove")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StorageZonesPanel({
  warehouseId,
  buildingId,
  floorNumber,
  floorWidthMm,
  floorDepthMm,
  floorHeightMm,
  zones,
}: {
  readonly warehouseId: string;
  readonly buildingId: string;
  readonly floorNumber: number;
  readonly floorWidthMm: number;
  readonly floorDepthMm: number;
  readonly floorHeightMm: number;
  readonly zones: readonly StorageZoneRow[];
}) {
  const t = useTranslations("StorageLayouts");
  const createZone = useMutation(storageLayoutRefs.createZone);
  const archiveZone = useMutation(storageLayoutRefs.archiveZone);
  const placeHandlingUnit = useMutation(storageLayoutRefs.placeHandlingUnit);
  const unitsOutcome = useQuery(listHandlingUnitsRef, {
    warehouseId,
    status: "ACTIVE",
    maxPageSize: 100,
  });
  const units: readonly HandlingUnitRow[] =
    unitsOutcome?.ok === true && unitsOutcome.value.ok
      ? unitsOutcome.value.items
      : [];
  const [label, setLabel] = useState("");
  const [zoneX, setZoneX] = useState("0");
  const [zoneY, setZoneY] = useState("0");
  const [zoneWidth, setZoneWidth] = useState("2");
  const [zoneDepth, setZoneDepth] = useState("2");
  const [stackHeight, setStackHeight] = useState(String(metres(floorHeightMm)));
  const [lpn, setLpn] = useState("");
  const [zoneScan, setZoneScan] = useState("");
  const [unitWidth, setUnitWidth] = useState("1.2");
  const [unitDepth, setUnitDepth] = useState("1");
  const [unitHeight, setUnitHeight] = useState("1.4");
  const [pendingAction, setPendingAction] = useState<string>();
  const [message, setMessage] = useState<{
    readonly tone: "success" | "warning";
    readonly text: string;
  }>();

  const selectUnit = (nextLpn: string) => {
    setLpn(nextLpn);
    const unit = units.find(
      (candidate) => candidate.lpn.toUpperCase() === nextLpn.toUpperCase(),
    );
    if (unit?.widthMm !== undefined) setUnitWidth(String(metres(unit.widthMm)));
    if (unit?.depthMm !== undefined) setUnitDepth(String(metres(unit.depthMm)));
    if (unit?.heightMm !== undefined)
      setUnitHeight(String(metres(unit.heightMm)));
  };

  const addStorageZone = async () => {
    setPendingAction("create");
    setMessage(undefined);
    try {
      const outcome = await createZone({
        warehouseId,
        buildingId,
        floorNumber,
        requestId: requestId(),
        label: label || t("newStorageZoneLabel", { number: zones.length + 1 }),
        xMm: millimetres(zoneX),
        yMm: millimetres(zoneY),
        widthMm: millimetres(zoneWidth),
        depthMm: millimetres(zoneDepth),
        maxStackHeightMm: millimetres(stackHeight),
      });
      if (!outcome.ok) {
        setMessage({
          tone: "warning",
          text: t("writeError", { code: outcome.denial.code }),
        });
      } else if (!outcome.value.written) {
        setMessage({
          tone: "warning",
          text: t("writeError", { code: outcome.value.error.code }),
        });
      } else {
        setLabel("");
        setMessage({ tone: "success", text: t("storageZoneCreated") });
      }
    } finally {
      setPendingAction(undefined);
    }
  };

  const removeStorageZone = async (zone: StorageZoneRow) => {
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
        setMessage({ tone: "warning", text: t("writeError", { code }) });
      } else if (!outcome.value.written) {
        const code = outcome.value.error.code;
        setMessage({ tone: "warning", text: t("writeError", { code }) });
      } else {
        setMessage({ tone: "success", text: t("storageZoneArchived") });
      }
    } finally {
      setPendingAction(undefined);
    }
  };

  const placeUnit = async () => {
    setPendingAction("place");
    setMessage(undefined);
    try {
      const outcome = await placeHandlingUnit({
        warehouseId,
        requestId: requestId(),
        lpn,
        zoneScan,
        widthMm: millimetres(unitWidth),
        depthMm: millimetres(unitDepth),
        heightMm: millimetres(unitHeight),
      });
      if (!outcome.ok) {
        const code = outcome.denial.code;
        setMessage({ tone: "warning", text: t("writeError", { code }) });
      } else if (!outcome.value.written) {
        const code = outcome.value.error.code;
        setMessage({ tone: "warning", text: t("writeError", { code }) });
      } else {
        setMessage({
          tone: outcome.value.capacityWarning ? "warning" : "success",
          text: outcome.value.capacityWarning
            ? t("stackHeightWarning", { level: outcome.value.levelIndex })
            : t("unitPlaced", { level: outcome.value.levelIndex }),
        });
        setLpn("");
      }
    } finally {
      setPendingAction(undefined);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
          <QrCode className="size-5" />
        </div>
        <div>
          <h2 className="font-semibold text-text">{t("storageZones")}</h2>
          <p className="mt-1 text-sm text-muted">{t("storageZonesHelp")}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 rounded-xl border border-border bg-background p-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <Label htmlFor="new-storage-zone-label">{t("zoneLabel")}</Label>
          <Input
            id="new-storage-zone-label"
            className="mt-2"
            value={label}
            placeholder={t("newStorageZoneLabel", { number: zones.length + 1 })}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        {[
          ["x", zoneX, setZoneX, 0, floorWidthMm],
          ["y", zoneY, setZoneY, 0, floorDepthMm],
          ["zoneWidth", zoneWidth, setZoneWidth, 0.1, floorWidthMm],
          ["zoneDepth", zoneDepth, setZoneDepth, 0.1, floorDepthMm],
        ].map(([key, value, setValue, min]) => (
          <div key={String(key)}>
            <Label htmlFor={`new-storage-zone-${String(key)}`}>
              {t(key as "x" | "y" | "zoneWidth" | "zoneDepth")}
            </Label>
            <Input
              id={`new-storage-zone-${String(key)}`}
              className="mt-2"
              type="number"
              min={Number(min)}
              step="0.1"
              value={String(value)}
              onChange={(event) =>
                (setValue as (value: string) => void)(event.target.value)
              }
            />
          </div>
        ))}
        <div className="md:col-span-2">
          <Label htmlFor="new-storage-zone-height">{t("maxStackHeight")}</Label>
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
        <div className="flex items-end md:col-span-4">
          <Button
            type="button"
            onClick={addStorageZone}
            disabled={pendingAction !== undefined}
          >
            <Plus className="size-4" />
            {pendingAction === "create"
              ? t("creating")
              : t("createStorageZone")}
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {zones.map((zone) => {
          const occupiedHeightMm = zone.placements.reduce(
            (total, placement) => total + placement.heightMm,
            0,
          );
          return (
            <article
              key={zone.zoneId}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex gap-4">
                <div
                  aria-label={t("qrForZone", { code: zone.code })}
                  className="shrink-0 rounded-lg bg-white p-2"
                >
                  <QRCodeSVG value={zone.qrValue} size={104} level="M" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold tracking-wider text-success uppercase">
                    {zone.code}
                  </p>
                  <h3 className="mt-1 truncate font-semibold text-text">
                    {zone.label}
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    {metres(zone.widthMm)} × {metres(zone.depthMm)} m ·{" "}
                    {t("stackUsed", {
                      used: metres(occupiedHeightMm),
                      maximum: metres(zone.maxStackHeightMm),
                    })}
                  </p>
                  <code className="mt-2 block text-[10px] break-all text-muted">
                    {zone.qrValue}
                  </code>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setZoneScan(zone.code)}
                    >
                      {t("useZone")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pendingAction !== undefined}
                      onClick={() => removeStorageZone(zone)}
                    >
                      <Trash2 className="size-3.5" />
                      {t("archiveZone")}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs font-semibold text-muted uppercase">
                  {t("stackOrder")}
                </p>
                {zone.placements.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">{t("emptyStack")}</p>
                ) : (
                  <ol className="mt-2 space-y-2">
                    {[...zone.placements].reverse().map((placement, index) => (
                      <li
                        key={placement.placementId}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Boxes className="size-4 shrink-0 text-accent" />
                          <span className="truncate font-medium text-text">
                            {placement.lpn}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted">
                          {index === 0
                            ? t("top")
                            : t("level", { level: placement.levelIndex })}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-5 rounded-xl border border-accent/30 bg-accent/5 p-4">
        <h3 className="font-semibold text-text">{t("scanPlacement")}</h3>
        <p className="mt-1 text-sm text-muted">{t("scanPlacementHelp")}</p>
        <datalist id="storage-handling-units">
          {units.map((unit) => (
            <option key={unit.handlingUnitId} value={unit.lpn} />
          ))}
        </datalist>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <div className="md:col-span-2">
            <Label htmlFor="stack-lpn">{t("handlingUnit")}</Label>
            <Input
              id="stack-lpn"
              className="mt-2"
              list="storage-handling-units"
              value={lpn}
              placeholder={t("scanLpn")}
              onChange={(event) => selectUnit(event.target.value)}
            />
          </div>
          <div className="md:col-span-3">
            <Label htmlFor="stack-zone-scan">{t("zoneCodeOrQr")}</Label>
            <Input
              id="stack-zone-scan"
              className="mt-2 font-mono"
              value={zoneScan}
              placeholder={t("scanZone")}
              onChange={(event) => setZoneScan(event.target.value)}
            />
          </div>
          {[
            ["unitWidth", unitWidth, setUnitWidth],
            ["unitDepth", unitDepth, setUnitDepth],
            ["unitHeight", unitHeight, setUnitHeight],
          ].map(([key, value, setValue]) => (
            <div key={String(key)}>
              <Label htmlFor={`stack-${String(key)}`}>
                {t(key as "unitWidth" | "unitDepth" | "unitHeight")}
              </Label>
              <Input
                id={`stack-${String(key)}`}
                className="mt-2"
                type="number"
                min="0.1"
                step="0.1"
                value={String(value)}
                onChange={(event) =>
                  (setValue as (value: string) => void)(event.target.value)
                }
              />
            </div>
          ))}
          <div className="flex items-end md:col-span-2">
            <Button
              type="button"
              className="w-full"
              disabled={
                pendingAction !== undefined ||
                lpn.trim() === "" ||
                zoneScan.trim() === ""
              }
              onClick={placeUnit}
            >
              <QrCode className="size-4" />
              {pendingAction === "place" ? t("placing") : t("confirmPlacement")}
            </Button>
          </div>
        </div>
      </div>

      {message === undefined ? null : (
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
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <IsometricBuilding building={building} floors={floors} />
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-background text-muted">
              <tr>
                <th className="p-4">{t("floors")}</th>
                <th className="p-4">{t("dimensions")}</th>
                <th className="p-4">{t("usableArea")}</th>
                <th className="p-4">{t("reservedArea")}</th>
              </tr>
            </thead>
            <tbody>
              {floors.map((floor) => (
                <tr key={floor.floorId} className="border-t border-border">
                  <th className="p-4 font-semibold">
                    {t("floor", { floor: floor.floorNumber })}
                  </th>
                  <td className="p-4">
                    {metres(floor.widthMm ?? building.widthMm)} ×{" "}
                    {metres(floor.depthMm ?? building.depthMm)} m
                  </td>
                  <td className="p-4">
                    {squareMetres(floor.usableAreaSqMm)} m²
                  </td>
                  <td className="p-4">
                    {squareMetres(floor.reservedAreaSqMm)} m²
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <aside className="space-y-4">
        <Notice
          tone={building.status === "DRAFT" ? "success" : "muted"}
          title={
            building.status === "DRAFT"
              ? t("readyToActivate")
              : statusLabel(t, building.status)
          }
          body={t("validationPassed")}
        />
        <CapacitySummary building={building} />
        {error === undefined ? null : (
          <Notice tone="warning" title={t("writeError", { code: error })} />
        )}
        <Button
          className="w-full"
          disabled={pending || building.status !== "DRAFT"}
          onClick={submit}
        >
          {pending ? t("activating") : t("activate")}
        </Button>
        <Button className="w-full" variant="outline" asChild>
          <Link href={storageBuildingPath(buildingId)}>
            <ArrowLeft className="size-4" />
            {t("editBuilding")}
          </Link>
        </Button>
      </aside>
    </div>
  );
}
