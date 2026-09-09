"use client";
import { useSyncExternalStore, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useLocale } from "next-intl";
import { LayoutGrid, Table2, Pencil, QrCode, ExternalLink } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../../convex/_generated/api";
import { clientRef, type RefValue } from "@/lib/convex/clientRef";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Link } from "@/i18n/navigation";
import { storageFloorPath } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StorageLayoutStatus } from "@/lib/convex/storageLayoutApi";

export const locationCatalogueRef = clientRef(
  api.storageLayouts.locationCatalogue.list,
);
type Row = RefValue<typeof locationCatalogueRef>[number];
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
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      p &&
      ["cards", "table"].includes(p.view) &&
      ["ALL", "DRAFT", "ACTIVE", "ARCHIVED"].includes(p.status) &&
      [p.search, p.building, p.floor].every((v) => typeof v === "string")
    )
      return p;
  } catch {}
  return initial;
}
export function StorageLocationCatalogue({
  warehouseId,
  children,
}: {
  warehouseId: string;
  children: (filters: CatalogueFilters) => ReactNode;
}) {
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return ready ? (
    <LocationCatalogueContent key={warehouseId} warehouseId={warehouseId}>
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
  const { navigationPermissions } = useWorkspace();
  const canEdit = navigationPermissions.includes(
    "masterData.storageLayout.manage",
  );
  const key = `storage-location-view:${warehouseId}`;
  const [prefs, setPrefs] = useState<Preferences>(() => readPreferences(key));
  const [qr, setQr] = useState<Row | null>(null);
  function change(patch: Partial<Preferences>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }
  const outcome = useQuery(
    locationCatalogueRef,
    prefs.view === "table" ? { warehouseId } : "skip",
  );
  const rows = outcome?.ok ? outcome.value : [];
  const buildings = [
    ...new Map(
      rows.map((r) => [
        r.buildingId,
        { value: r.buildingId, label: `${r.buildingCode} · ${r.buildingName}` },
      ]),
    ).values(),
  ];
  const floors = [
    ...new Set(
      rows
        .filter(
          (r) => prefs.building === "ALL" || r.buildingId === prefs.building,
        )
        .map((r) => r.floorNumber),
    ),
  ].sort((a, b) => a - b);
  const needle = prefs.search.trim().toLocaleLowerCase();
  const shown = rows.filter(
    (r) =>
      (prefs.status === "ALL" || r.status === prefs.status) &&
      (prefs.building === "ALL" || prefs.building === r.buildingId) &&
      (prefs.floor === "ALL" || prefs.floor === String(r.floorNumber)) &&
      `${r.label} ${r.code} ${r.buildingName} ${r.buildingCode} ${r.positions.map((p) => `${p.label} ${p.code}`).join(" ")}`
        .toLocaleLowerCase()
        .includes(needle),
  );
  const statusName = (s: string) =>
    s === "ACTIVE"
      ? tr("Active", "ใช้งานอยู่")
      : s === "DRAFT"
        ? tr("Draft", "ฉบับร่าง")
        : tr("Archived", "เก็บถาวร");
  return (
    <div className="space-y-4">
      <div
        className="flex gap-2"
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
              variant={prefs.view === view ? "default" : "outline"}
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
          {!outcome ? (
            <p role="status">
              {tr("Loading locations…", "กำลังโหลดจุดจัดเก็บ…")}
            </p>
          ) : !outcome.ok ? (
            <p role="alert">
              {tr(
                "Locations could not be loaded. Check your access and connection, then refresh.",
                "โหลดจุดจัดเก็บไม่ได้ กรุณาตรวจสอบสิทธิ์และการเชื่อมต่อ แล้วรีเฟรช",
              )}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">
                {shown.length} / {rows.length} {tr("locations", "จุดจัดเก็บ")}
              </p>
              {shown.length === 0 ? (
                <div className="py-10 text-center">
                  <p>
                    {rows.length
                      ? tr("No matching locations", "ไม่พบจุดจัดเก็บที่ตรงกัน")
                      : tr(
                          "No locations yet. Add a storage spot from a building’s floor planner.",
                          "ยังไม่มีจุดจัดเก็บ เพิ่มจุดจัดเก็บในหน้าวางผังชั้นของอาคาร",
                        )}
                  </p>
                  {rows.length > 0 && (
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
                  className="overflow-x-auto rounded-xl border border-border"
                  role="region"
                  aria-label={tr("Location results", "ผลการค้นหาจุดจัดเก็บ")}
                  tabIndex={0}
                >
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">
                      {tr("All storage locations", "จุดจัดเก็บทั้งหมด")}
                    </caption>
                    <thead className="bg-surface">
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
                            className="border-t border-border align-top"
                          >
                            <td className="min-w-44 p-3">
                              <Link
                                className="font-medium text-accent"
                                href={`${path}#storage-zone-${row.zoneId}`}
                              >
                                {row.label}
                              </Link>
                              <p className="mt-1 text-xs break-all text-muted">
                                {row.code}
                              </p>
                              <details className="mt-2">
                                <summary className="cursor-pointer text-xs">
                                  {tr(
                                    "Sublocations / occupancy",
                                    "ตำแหน่งย่อย / การจัดเก็บ",
                                  )}{" "}
                                  ({row.positions.length} /{" "}
                                  {row.palletCount ?? row.placements.length})
                                </summary>
                                <div className="mt-2 space-y-2 text-xs">
                                  {row.positions.length +
                                    row.placements.length ===
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
                                      {row.occupiedFootprintAreaSqMm !==
                                        undefined && (
                                        <p className="text-muted">
                                          {tr(
                                            "Occupied and reserved footprint",
                                            "พื้นที่ฐานที่ใช้และจอง",
                                          )}
                                          :{" "}
                                          {(
                                            row.occupiedFootprintAreaSqMm /
                                            1_000_000
                                          ).toLocaleString(undefined, {
                                            maximumFractionDigits: 3,
                                          })}{" "}
                                          m²
                                        </p>
                                      )}
                                      {row.positions.map((p) => (
                                        <p key={p.id}>
                                          {p.label} · {p.code} · X{" "}
                                          {p.xMm === undefined
                                            ? "—"
                                            : p.xMm / 1000}{" "}
                                          / Y{" "}
                                          {p.yMm === undefined
                                            ? "—"
                                            : p.yMm / 1000}{" "}
                                          / Z {p.zMm / 1000} m ·{" "}
                                          {statusName(p.status)}
                                        </p>
                                      ))}
                                      {row.placements.map((p) => (
                                        <p key={p.id}>
                                          {p.code} · X {p.xMm / 1000} / Y{" "}
                                          {p.yMm / 1000} / Z {p.zMm / 1000} m ·{" "}
                                          {p.rotation}° ·{" "}
                                          {p.moveRole === "TARGET"
                                            ? tr(
                                                "Move destination reserved",
                                                "จองปลายทางการย้าย",
                                              )
                                            : p.moveRole === "SOURCE"
                                              ? p.moveState === "IN_TRANSIT"
                                                ? tr(
                                                    "Last confirmed position · moving",
                                                    "ตำแหน่งยืนยันล่าสุด · กำลังย้าย",
                                                  )
                                                : tr(
                                                    "Move source",
                                                    "ต้นทางการย้าย",
                                                  )
                                              : p.status === "STORED"
                                                ? tr("Stored", "จัดเก็บแล้ว")
                                                : tr("Reserved", "จองแล้ว")}
                                        </p>
                                      ))}
                                    </>
                                  )}
                                </div>
                              </details>
                            </td>
                            <td className="p-3">
                              {row.buildingName}
                              <p className="mt-1 text-xs text-muted">
                                {row.buildingCode} · {tr("Floor", "ชั้น")}{" "}
                                {row.floorNumber}
                              </p>
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              {row.widthMm / 1000} × {row.depthMm / 1000} ×{" "}
                              {row.heightMm / 1000} m
                            </td>
                            <td className="p-3">{statusName(row.status)}</td>
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
                                      href={`${path}?editZone=${row.zoneId}#storage-zone-${row.zoneId}`}
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
        </>
      )}
      <Dialog
        open={qr !== null}
        onOpenChange={(open) => {
          if (!open) setQr(null);
        }}
      >
        <DialogContent closeLabel={tr("Close", "ปิด")}>
          <DialogHeader>
            <DialogTitle>{qr?.label} · QR</DialogTitle>
            <DialogDescription>
              {tr(
                "Scan to identify this storage location.",
                "สแกนเพื่อระบุจุดจัดเก็บนี้",
              )}
            </DialogDescription>
          </DialogHeader>
          {qr && (
            <>
              <div className="mx-auto grid size-60 place-items-center rounded-lg bg-white p-4">
                <QRCodeSVG
                  size={208}
                  value={qr.qrValue}
                  aria-label={`QR ${qr.code}`}
                />
              </div>
              <p className="text-center text-sm">{qr.code}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
