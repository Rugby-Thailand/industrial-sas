"use client";

import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Box,
  Building2,
  CheckCircle2,
  Layers3,
  Plus,
  Ruler,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";

import { QueryGate } from "@/components/system/QueryGate";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
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
} from "@/lib/convex/storageLayoutApi";
import {
  buildIsometricBuilding,
  pointsAttribute,
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
        <BuildingModelWorkspace building={building} floors={floors} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {floors.map((floor) => (
            <FloorCard
              key={floor.floorId}
              buildingId={buildingId}
              floor={floor}
              building={building}
            />
          ))}
        </div>
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
        {building.status === "DRAFT" ? (
          <BuildingSettings warehouseId={warehouseId} building={building} />
        ) : null}
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
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-semibold text-text">{t("dimensions")}</h2>
      <form onSubmit={saveDimensions} className="mt-4 grid gap-3">
        <Field label={t("name")} name="name" defaultValue={building.name} />
        <div className="grid grid-cols-3 gap-2">
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
    </section>
  );
}

function FloorCard({
  buildingId,
  floor,
  building,
}: {
  readonly buildingId: string;
  readonly floor: StorageFloorRow;
  readonly building: StorageBuildingRow;
}) {
  const t = useTranslations("StorageLayouts");
  return (
    <Link
      href={storageFloorPath(buildingId, floor.floorNumber)}
      className="rounded-xl border border-border bg-surface p-4 transition hover:border-accent hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-lg bg-accent/10 text-accent">
          <Box className="size-5" />
        </span>
        <span className="text-xs text-muted">
          {squareMetres(floor.usableAreaSqMm).toLocaleString()} m²
        </span>
      </div>
      <h3 className="mt-4 font-semibold text-text">
        {t("floor", { floor: floor.floorNumber })}
      </h3>
      <p className="mt-1 text-xs text-muted">
        {metres(floor.widthMm ?? building.widthMm)} ×{" "}
        {metres(floor.depthMm ?? building.depthMm)} m
      </p>
    </Link>
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

function IsometricBuilding({
  building,
  floors,
  highlightedFloorNumber,
}: {
  readonly building: StorageBuildingRow;
  readonly floors: readonly StorageFloorRow[];
  readonly highlightedFloorNumber?: number;
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
        })),
        { scale: 0.012, gap: 8 },
      ),
    [building, floors],
  );
  const topSlab = geometry.slabs.at(-1);
  return (
    <figure className="relative overflow-hidden rounded-2xl border border-border bg-[linear-gradient(145deg,var(--color-surface),var(--color-background))] p-5 shadow-sm">
      <figcaption className="absolute top-5 left-5 z-10 text-sm font-semibold text-muted">
        {t("modelLabel")}
      </figcaption>
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
          {[...geometry.slabs].reverse().map((slab) => (
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

function BuildingModelWorkspace({
  building,
  floors,
}: {
  readonly building: StorageBuildingRow;
  readonly floors: readonly StorageFloorRow[];
}) {
  const t = useTranslations("StorageLayouts");
  const [selectedFloorNumber, setSelectedFloorNumber] = useState(
    floors.at(-1)?.floorNumber ?? 1,
  );
  return (
    <div className="grid overflow-hidden rounded-2xl border border-border bg-surface shadow-sm lg:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="border-b border-border p-4 lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <Layers3 className="size-4 text-accent" />
          {t("floors")}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
          {[...floors].reverse().map((floor) => (
            <button
              key={floor.floorId}
              type="button"
              onClick={() => setSelectedFloorNumber(floor.floorNumber)}
              aria-pressed={selectedFloorNumber === floor.floorNumber}
              className="flex min-h-11 items-center justify-between rounded-lg border border-border px-3 text-sm text-text transition hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-accent"
            >
              <span>{t("floor", { floor: floor.floorNumber })}</span>
              <span className="text-xs text-muted">
                {squareMetres(floor.usableAreaSqMm).toLocaleString()} m²
              </span>
            </button>
          ))}
        </div>
      </div>
      <IsometricBuilding
        building={building}
        floors={floors}
        highlightedFloorNumber={selectedFloorNumber}
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
          maximumWidthMm={detail.building.widthMm}
          maximumDepthMm={detail.building.depthMm}
          blocks={blocks}
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
            {metres(actualWidth)} × {metres(actualDepth)} m
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

function FloorPlan({
  widthMm,
  depthMm,
  maximumWidthMm,
  maximumDepthMm,
  blocks,
}: {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly maximumWidthMm: number;
  readonly maximumDepthMm: number;
  readonly blocks: readonly EditableBlock[];
}) {
  const t = useTranslations("StorageLayouts");
  const drawingWidth = Math.max(widthMm, maximumWidthMm, 1);
  const drawingDepth = Math.max(depthMm, maximumDepthMm, 1);
  const padding = Math.max(drawingWidth, drawingDepth) * 0.09;
  const labelSize = Math.max(drawingWidth, drawingDepth) / 38;
  const gridStep = 1_000;
  return (
    <figure className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <figcaption className="mb-4 text-sm font-semibold text-muted">
        {t("planLabel")}
      </figcaption>
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
          width={maximumWidthMm}
          height={maximumDepthMm}
          className="fill-none stroke-muted"
          strokeDasharray={`${padding / 5} ${padding / 5}`}
          strokeWidth={Math.max(30, drawingWidth / 900)}
          vectorEffect="non-scaling-stroke"
        />
        <rect
          width={widthMm}
          height={depthMm}
          className="fill-accent/15 stroke-accent"
          strokeWidth={Math.max(40, drawingWidth / 700)}
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={widthMm / 2}
          y={-padding * 0.35}
          textAnchor="middle"
          className="fill-accent font-semibold"
          style={{ fontSize: labelSize }}
        >
          {metres(widthMm)} m
        </text>
        <text
          x={widthMm + padding * 0.32}
          y={depthMm / 2}
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
              x={block.xMm}
              y={block.yMm}
              width={block.widthMm}
              height={block.depthMm}
              fill="url(#storage-reserved-hatch)"
              className="stroke-warning"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={block.xMm + block.widthMm / 2}
              y={block.yMm + block.depthMm / 2}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-warning font-semibold"
              style={{ fontSize: labelSize }}
            >
              {block.label}
            </text>
          </g>
        ))}
      </svg>
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
          <i className="mr-2 inline-block size-3 rounded-sm border border-dashed border-muted" />
          {t("maximumEnvelope")}
        </span>
      </div>
    </figure>
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
