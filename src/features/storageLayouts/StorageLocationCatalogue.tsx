"use client";
import { preferences } from "@/lib/browser/storage";

import { BuildingStatusToggle } from "./BuildingStatusToggle";
import { useSyncExternalStore, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { CursorPagination } from "@/components/system/CursorPagination";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import {
  useDebouncedSearch,
  useScanContinuation,
} from "@/hooks/useScanContinuation";
import { useQuery } from "convex/react";
import { useLocale } from "next-intl";
import { LayoutGrid, Table2, Pencil, QrCode, ExternalLink } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { clientRef, type RefValue } from "@/lib/convex/clientRef";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Link } from "@/i18n/navigation";
import { storageFloorPath } from "@/lib/navigation";
import { scopeKey } from "@/lib/browser/scope";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import { Button } from "@/components/ui/button";
import { DataGate } from "@/components/system/DataGate";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import type { StorageLayoutStatus } from "@/lib/convex/storageLayoutApi";
import { QrDialog } from "@/features/storageKit/QrDialog";

export const locationCatalogueRef = clientRef(
  api.storageLayouts.locationCatalogue.list,
);
const locationDetailRef = clientRef(
  api.storageLayouts.locationCatalogue.detail,
);
const locationPageRef = clientRef(api.storageLayouts.locationCatalogue.page);
const locationOptionsRef = clientRef(
  api.storageLayouts.locationCatalogue.options,
);
type Row = RefValue<typeof locationPageRef>["page"][number];
export type CatalogueFilters = {
  search: string;
  status: StorageLayoutStatus | "ALL";
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StorageLayoutStatus | "ALL") => void;
};
type Preferences = {
  view: "cards" | "table";
  search: string;
  status: StorageLayoutStatus | "ALL";
  building: string;
  floor: string;
};
const initial: Preferences = {
  view: "cards",
  search: "",
  status: "ALL",
  building: "ALL",
  floor: "ALL",
};
function readPreferences(key: string): Preferences {
  return preferences.read(
    key,
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return initial;
      const p = value as Record<string, unknown>;
      if (
        (p.view === "cards" || p.view === "table") &&
        (p.status === "ALL" ||
          p.status === "DRAFT" ||
          p.status === "ACTIVE" ||
          p.status === "ARCHIVED") &&
        typeof p.search === "string" &&
        typeof p.building === "string" &&
        typeof p.floor === "string"
      )
        return {
          view: p.view,
          status: p.status,
          search: p.search,
          building: p.building,
          floor: p.floor,
        };
      return initial;
    },
    initial,
  );
}

export function StorageLocationCatalogue({
  warehouseId,
  children,
}: {
  warehouseId: string;
  children: (filters: CatalogueFilters) => ReactNode;
}) {
  const { userId, orgId } = useAuth();
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const actorKey = `${orgId ?? "null"}:${userId ?? "anonymous"}`;
  return ready ? (
    <LocationCatalogueContent
      key={`${warehouseId}:${actorKey}`}
      warehouseId={warehouseId}
    >
      {children}
    </LocationCatalogueContent>
  ) : null;
}
function LocationCatalogueContent({
  warehouseId,
  children,
}: {
  warehouseId: string;
  children: (filters: CatalogueFilters) => ReactNode;
}) {
  const th = useLocale() === "th";
  const tr = (en: string, thai: string) => (th ? thai : en);
  const { navigationPermissions, permissionsReady } = useWorkspace();
  const canEdit =
    permissionsReady &&
    navigationPermissions.includes("masterData.storageLayout.manage");
  const { userId, orgId } = useAuth();
  const persistenceOrganization = orgId ?? "null";
  const persistenceUser = userId ?? "anonymous";
  const key = scopeKey({
    feature: "storage-location-view",
    organizationId: persistenceOrganization,
    userId: persistenceUser,
    warehouseId,
  });
  const [prefs, setPrefs] = useState<Preferences>(() => readPreferences(key));
  const [qr, setQr] = useState<Row | null>(null);
  function change(patch: Partial<Preferences>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    preferences.write(key, next);
  }
  const settled = useDebouncedSearch(prefs.search);
  const criteria = {
    warehouseId,
    search: settled,
    status: prefs.status,
    building: prefs.building,
    floor: prefs.floor,
  };
  const paging = useCursorPagination({
    scope: scopeKey({
      feature: "storage-location-catalogue",
      organizationId: persistenceOrganization,
      userId: persistenceUser,
      warehouseId,
    }),
    criteria,
  });
  const scan = useScanContinuation(
    JSON.stringify([criteria, paging.cursor, paging.pageSize]),
  );
  const outcome = useQuery(
    locationPageRef,
    prefs.view === "table" && prefs.search === settled
      ? {
          warehouseId,
          search: settled,
          ...(prefs.status !== "ALL" ? { status: prefs.status } : {}),
          ...(prefs.building !== "ALL" ? { buildingId: prefs.building } : {}),
          ...(prefs.floor !== "ALL"
            ? { floorNumber: Number(prefs.floor) }
            : {}),
          pageSize: paging.pageSize,
          ...(paging.cursor ? { cursor: paging.cursor } : {}),
          ...(scan.cursor ? { scanCursor: scan.cursor } : {}),
        }
      : "skip",
  );
  const [optionCursor, setOptionCursor] = useState<string>();
  const [previousOptions, setPreviousOptions] = useState<
    RefValue<typeof locationOptionsRef>["page"]
  >([]);
  const choices = useQuery(
    locationOptionsRef,
    prefs.view === "table"
      ? { warehouseId, ...(optionCursor ? { cursor: optionCursor } : {}) }
      : "skip",
  );
  const allOptions = [
    ...new Map(
      [...previousOptions, ...(choices?.ok ? choices.value.page : [])].map(
        (row) => [row.buildingId, row],
      ),
    ).values(),
  ];
  const resetScope = JSON.stringify(criteria);
  useCatalogueSync({
    outcome,
    continuation: scan,
    paging,
    resetKey: resetScope,
    hasRows: (value) => Boolean(value.page?.length),
  });
  const ready = outcome?.ok && outcome.value.status === "ready";
  const rows = ready ? outcome.value.page : [];
  const shown = rows;
  const buildings = allOptions.map((r) => ({
    value: r.buildingId,
    label: `${r.buildingCode} · ${r.buildingName}`,
  }));
  const floors = [
    ...new Set(
      allOptions
        .filter(
          (r) => prefs.building === "ALL" || r.buildingId === prefs.building,
        )
        .flatMap((r) => Array.from({ length: r.floorCount }, (_, i) => i + 1)),
    ),
  ].sort((a, b) => a - b);
  const statusName = (s: string) =>
    s === "ACTIVE"
      ? tr("Active", "ใช้งานอยู่")
      : s === "DRAFT"
        ? tr("Draft", "ฉบับร่าง")
        : tr("Archived", "เก็บถาวร");
  return (
    <div className="space-y-4">
      <div
        className="inline-flex max-w-full gap-1 rounded-lg border border-border bg-surface p-1"
        role="group"
        aria-label={tr("Catalogue view", "มุมมองรายการ")}
      >
        {(["cards", "table"] as const).map((view) => {
          const label =
            view === "cards"
              ? tr("Buildings", "อาคาร")
              : tr("All locations", "จุดจัดเก็บทั้งหมด");
          const Icon = view === "cards" ? LayoutGrid : Table2;
          return (
            <Button
              key={view}
              variant={prefs.view === view ? "secondary" : "ghost"}
              size="icon"
              title={label}
              aria-label={label}
              aria-pressed={prefs.view === view}
              onClick={() => change({ view })}
            >
              <Icon className="size-4" aria-hidden="true" />
            </Button>
          );
        })}
      </div>
      {prefs.view === "cards" ? (
        children({
          search: prefs.search,
          status: prefs.status,
          onSearchChange: (search) => change({ search }),
          onStatusChange: (status) => change({ status }),
        })
      ) : (
        <>
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_8rem]"
            data-testid="location-filters"
          >
            <Input
              aria-label={tr("Search locations", "ค้นหาจุดจัดเก็บ")}
              placeholder={tr(
                "Search location, code or building…",
                "ค้นหาชื่อจุด รหัส หรืออาคาร…",
              )}
              value={prefs.search}
              onChange={(e) => change({ search: e.target.value })}
            />
            <SelectControl
              label={tr("Status", "สถานะ")}
              value={prefs.status}
              onValueChange={(status) =>
                change({ status: status as Preferences["status"] })
              }
              options={[
                { value: "ALL", label: tr("All statuses", "ทุกสถานะ") },
                ...["ACTIVE", "DRAFT", "ARCHIVED"].map((value) => ({
                  value,
                  label: statusName(value),
                })),
              ]}
              placeholder=""
              emptyLabel=""
            />
            <SelectControl
              label={tr("Building", "อาคาร")}
              value={prefs.building}
              onValueChange={(building) => change({ building, floor: "ALL" })}
              options={[
                { value: "ALL", label: tr("All buildings", "ทุกอาคาร") },
                ...buildings,
              ]}
              placeholder=""
              emptyLabel=""
            />
            <SelectControl
              label={tr("Floor", "ชั้น")}
              value={prefs.floor}
              onValueChange={(floor) => change({ floor })}
              options={[
                { value: "ALL", label: tr("All floors", "ทุกชั้น") },
                ...floors.map((n) => ({ value: String(n), label: String(n) })),
              ]}
              placeholder=""
              emptyLabel=""
            />
          </div>
          {choices?.ok && !choices.value.isDone && (
            <Button
              variant="ghost"
              onClick={() => {
                setPreviousOptions(allOptions);
                setOptionCursor(choices.value.continueCursor);
              }}
            >
              {tr("Load more building choices", "โหลดตัวเลือกอาคารเพิ่มเติม")}
            </Button>
          )}
          {!outcome || (outcome.ok && outcome.value.status === "scanning") ? (
            <p role="status">
              {tr("Loading locations…", "กำลังโหลดจุดจัดเก็บ…")}
            </p>
          ) : !outcome.ok || outcome.value.status === "reset" ? (
            <p role="alert">
              {tr(
                "Locations could not be loaded. Check your access and connection, then refresh.",
                "โหลดจุดจัดเก็บไม่ได้ กรุณาตรวจสอบสิทธิ์และการเชื่อมต่อ แล้วรีเฟรช",
              )}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">
                {shown.length}{" "}
                {tr("locations on this page", "จุดจัดเก็บในหน้านี้")}
              </p>
              {shown.length === 0 ? (
                <div className="py-10 text-center">
                  <p>
                    {prefs.search ||
                    prefs.status !== "ALL" ||
                    prefs.building !== "ALL" ||
                    prefs.floor !== "ALL"
                      ? tr("No matching locations", "ไม่พบจุดจัดเก็บที่ตรงกัน")
                      : tr(
                          "No locations yet. Add a storage spot from a building’s floor planner.",
                          "ยังไม่มีจุดจัดเก็บ เพิ่มจุดจัดเก็บในหน้าวางผังชั้นของอาคาร",
                        )}
                  </p>
                  {(prefs.search ||
                    prefs.status !== "ALL" ||
                    prefs.building !== "ALL" ||
                    prefs.floor !== "ALL") && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        change({
                          search: "",
                          status: "ALL",
                          building: "ALL",
                          floor: "ALL",
                        })
                      }
                    >
                      {tr("Clear filters", "ล้างตัวกรอง")}
                    </Button>
                  )}
                </div>
              ) : (
                <div
                  className="min-w-0 overflow-x-auto rounded-lg border border-border bg-surface focus-visible:outline-ring"
                  role="region"
                  aria-label={tr("Location results", "ผลการค้นหาจุดจัดเก็บ")}
                  tabIndex={0}
                >
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">
                      {tr("All storage locations", "จุดจัดเก็บทั้งหมด")}
                    </caption>
                    <thead className="bg-raised">
                      <tr>
                        {[
                          tr("Location / code", "จุดจัดเก็บ / รหัส"),
                          tr("Building / floor", "อาคาร / ชั้น"),
                          tr("Dimensions", "ขนาด"),
                          tr("Status", "สถานะ"),
                          tr("Actions", "จัดการ"),
                        ].map((label) => (
                          <th key={label} className="p-3 font-medium">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row) => {
                        const path = storageFloorPath(
                          row.buildingId,
                          row.floorNumber,
                        );
                        return (
                          <tr
                            key={row.zoneId}
                            className="border-t border-border align-top hover:bg-raised/50"
                          >
                            <td className="min-w-44 p-3">
                              <Link
                                className="font-medium text-link"
                                href={`${path}#storage-zone-${row.zoneId}`}
                              >
                                {row.label}
                              </Link>
                              <p className="mt-1 text-xs break-all text-muted">
                                {row.code}
                              </p>
                              <LocationDetails source={row} />
                            </td>
                            <td className="p-3">
                              {row.buildingName}
                              <p className="mt-1 text-xs text-muted">
                                {row.buildingCode} · {tr("Floor", "ชั้น")}{" "}
                                {row.floorNumber}
                              </p>
                            </td>
                            <td className="p-3 whitespace-nowrap tabular-nums">
                              {row.widthMm / 1000} × {row.depthMm / 1000} ×{" "}
                              {row.heightMm / 1000} m
                            </td>
                            <td className="p-3">
                              {row.status === "ARCHIVED" ? (
                                statusName(row.status)
                              ) : (
                                <BuildingStatusToggle
                                  warehouseId={warehouseId}
                                  buildingId={row.buildingId}
                                  code={row.buildingCode}
                                  status={row.status}
                                />
                              )}
                            </td>
                            <td className="p-3">
                              <div className="flex gap-1">
                                <Button
                                  asChild
                                  variant="ghost"
                                  size="icon"
                                  title={tr("Open location", "เปิดจุดจัดเก็บ")}
                                >
                                  <Link
                                    aria-label={`${tr("Open", "เปิด")} ${row.label}`}
                                    href={`${path}#storage-zone-${row.zoneId}`}
                                  >
                                    <ExternalLink className="size-4" />
                                  </Link>
                                </Button>
                                {canEdit && row.status !== "ARCHIVED" && (
                                  <Button
                                    asChild
                                    variant="ghost"
                                    size="icon"
                                    title={tr(
                                      "Edit location",
                                      "แก้ไขจุดจัดเก็บ",
                                    )}
                                  >
                                    <Link
                                      aria-label={`${tr("Edit", "แก้ไข")} ${row.label}`}
                                      href={`${path}&editZone=${encodeURIComponent(row.zoneId)}#storage-zone-${row.zoneId}`}
                                    >
                                      <Pencil className="size-4" />
                                    </Link>
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="QR"
                                  aria-label={`QR ${row.label}`}
                                  onClick={() => setQr(row)}
                                >
                                  <QrCode className="size-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
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
            locale={th ? "th" : "en"}
          />
        </>
      )}
      {qr && (
        <QrDialog
          open
          onOpenChange={(open) => {
            if (!open) setQr(null);
          }}
          title={`${qr.label} · QR`}
          description={tr(
            "Scan to identify this storage location.",
            "สแกนเพื่อระบุจุดจัดเก็บนี้",
          )}
          value={qr.qrValue}
          code={qr.code}
          closeLabel={tr("Close", "ปิด")}
          ariaLabel={`QR ${qr.code}`}
        />
      )}
    </div>
  );
}

function LocationDetails({ source }: { source: Row }) {
  const th = useLocale() === "th";
  const tr = (en: string, thai: string) => (th ? thai : en);
  const [open, setOpen] = useState(false);
  const outcome = useQuery(
    locationDetailRef,
    open ? { warehouseId: source.warehouseId, zoneId: source.zoneId } : "skip",
  );
  const detail = outcome?.ok ? outcome.value : null;
  const row = detail ?? {
    ...source,
    placements: [],
    palletCount: undefined,
    occupiedFootprintAreaSqMm: undefined,
  };
  const statusName = (status: string) =>
    status === "ACTIVE"
      ? tr("Active", "ใช้งานอยู่")
      : status === "DRAFT"
        ? tr("Draft", "ฉบับร่าง")
        : tr("Archived", "เก็บถาวร");
  return (
    <details
      className="mt-2"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs">
        {tr("Sublocations / occupancy", "ตำแหน่งย่อย / การจัดเก็บ")} (
        {detail ? row.positions.length : "—"} / {row.palletCount ?? "—"})
      </summary>
      <div className="mt-2 space-y-2 text-xs">
        {open ? (
          <DataGate outcome={outcome}>
            {() =>
              !detail ? null : row.positions.length + row.placements.length ===
                0 ? (
                <p>
                  {tr(
                    "No sublocations or occupied positions",
                    "ไม่มีตำแหน่งย่อยหรือสินค้าที่จัดเก็บ",
                  )}
                </p>
              ) : (
                <>
                  <p className="text-muted">
                    {tr(
                      "Sublocation X/Y: floor origin; pallet X/Y: location origin. Z: base elevation.",
                      "X/Y ตำแหน่งย่อยอ้างอิงชั้น; X/Y พาเลทอ้างอิงจุดจัดเก็บ; Z คือระดับฐาน",
                    )}
                  </p>
                  {row.occupiedFootprintAreaSqMm !== undefined && (
                    <p className="text-muted">
                      {tr(
                        "Occupied and reserved footprint",
                        "พื้นที่ฐานที่ใช้และจอง",
                      )}
                      :{" "}
                      {(
                        row.occupiedFootprintAreaSqMm / 1_000_000
                      ).toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })}{" "}
                      m²
                      {row.placements.some(
                        (p) => p.mode === "LOCATION_ONLY",
                      ) && (
                        <>
                          {" "}
                          ·{" "}
                          {tr(
                            "Measured area only; unmeasured units are also stored here",
                            "เฉพาะพื้นที่ที่วัด มีหน่วยที่ยังไม่วัดจัดเก็บอยู่ด้วย",
                          )}
                        </>
                      )}
                    </p>
                  )}
                  {row.positions.map((p) => (
                    <p key={p.id}>
                      {p.label} · {p.code} · X{" "}
                      {p.xMm === undefined ? "—" : p.xMm / 1000} / Y{" "}
                      {p.yMm === undefined ? "—" : p.yMm / 1000} / Z{" "}
                      {p.zMm / 1000} m · {statusName(p.status)}
                    </p>
                  ))}
                  {row.placements.map((p) =>
                    p.mode === "LOCATION_ONLY" ? (
                      <p key={p.id}>
                        {p.code} ·{" "}
                        {tr(
                          "Location saved · coordinates unmeasured",
                          "บันทึกจุดจัดเก็บแล้ว · ไม่ได้วัดพิกัด",
                        )}{" "}
                        · #{p.sequence}
                      </p>
                    ) : (
                      <p key={p.id}>
                        {p.code} · X {p.xMm / 1000} / Y {p.yMm / 1000} / Z{" "}
                        {p.zMm / 1000} m · {p.rotation}° ·{" "}
                        {p.moveRole === "TARGET"
                          ? tr("Move destination reserved", "จองปลายทางการย้าย")
                          : p.moveRole === "SOURCE"
                            ? p.moveState === "IN_TRANSIT"
                              ? tr(
                                  "Last confirmed position · moving",
                                  "ตำแหน่งยืนยันล่าสุด · กำลังย้าย",
                                )
                              : tr("Move source", "ต้นทางการย้าย")
                            : p.status === "STORED"
                              ? tr("Stored", "จัดเก็บแล้ว")
                              : tr("Reserved", "จองแล้ว")}
                      </p>
                    ),
                  )}
                </>
              )
            }
          </DataGate>
        ) : null}
      </div>
    </details>
  );
}
