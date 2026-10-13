"use client";

import { drafts } from "@/lib/browser/storage";
import { useDraftKey } from "@/hooks/useDraftKey";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { QueryGate } from "@/components/system/QueryGate";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageContainer } from "@/components/ui/PageContainer";
import { Button } from "@/components/ui/button";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { FG_PATH, palletPath, batchPath } from "@/lib/navigation";
import type { RefValue } from "@/lib/convex/clientRef";
import { BarcodeCameraBox } from "./BarcodeCameraBox";
import {
  ErrorNotice,
  Field,
  useCanManage,
  useFGText,
  useOperation,
  ViewOnlyNotice,
  written,
  Loading,
} from "./shared";

type Context = { unitId?: string; batchId?: string };
type ResolvedUnit = Extract<
  RefValue<typeof fgRefs.resolvePackageCode>,
  { ok: true }
>["unit"];
type ResolvedLocation = Extract<
  RefValue<typeof fgRefs.resolveLocationCode>,
  { ok: true }
>["location"];
type Unit = ResolvedUnit & { fill: string };

export function PackageScanScreen(context: Context) {
  const scope = useDraftKey("fg-package-assignment");
  if (!scope) return <Loading />;
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <PackageAssignment
          scope={scope}
          key={`${scope}:${warehouseId}:${context.unitId ?? ""}:${context.batchId ?? ""}`}
          warehouseId={warehouseId}
          {...context}
        />
      )}
    </QueryGate>
  );
}

export function PackageAssignment({
  warehouseId,
  scope,
  unitId,
  batchId,
}: Context & { warehouseId: string; scope: string }) {
  const { tr } = useFGText();
  const canManage = useCanManage();
  const convex = useConvex();
  const key = `${scope}:${warehouseId}:${unitId ?? ""}:${batchId ?? ""}`;
  const op = useOperation(key);
  const [restored] = useState(() =>
    drafts.read(
      key,
      (value) => {
        if (!value || typeof value !== "object") return null;
        const candidate = value as {
          units?: Unit[];
          location?: ResolvedLocation;
          sameSize?: boolean;
          physical?: boolean;
          uncertain?: boolean;
          receiptId?: string;
          locationMethod?: "MANUAL" | "SCAN";
        };
        if (
          !Array.isArray(candidate.units) ||
          candidate.units.length > 50 ||
          !candidate.units.every(
            (unit) =>
              typeof unit.id === "string" &&
              typeof unit.code === "string" &&
              typeof unit.fill === "string" &&
              typeof unit.version === "number" &&
              Number.isFinite(unit.version) &&
              (!batchId || unit.batchId === batchId),
          ) ||
          (unitId &&
            candidate.units.length &&
            candidate.units[0]!.id !== unitId)
        )
          return null;
        if (
          candidate.location &&
          (typeof candidate.location.zoneId !== "string" ||
            typeof candidate.location.code !== "string" ||
            typeof candidate.location.version !== "string")
        )
          return null;
        return candidate;
      },
      null,
    ),
  );
  const assign = useMutation(fgRefs.confirmScanAssignment);
  const [units, setUnits] = useState<Unit[]>(restored?.units ?? []);
  const [code, setCode] = useState("");
  const [locationCode, setLocationCode] = useState(
    restored?.location?.code ?? "",
  );
  const [location, setLocation] = useState<ResolvedLocation | undefined>(
    restored?.location,
  );
  const [locationMethod, setLocationMethod] = useState<"MANUAL" | "SCAN">(
    "MANUAL",
  );
  const [sameSize, setSameSize] = useState(restored?.sameSize ?? false);
  const [physical, setPhysical] = useState(restored?.physical ?? false);
  const [scanner, setScanner] = useState<"PACKAGES" | "LOCATION" | null>(null);
  const scannerRef = useRef<typeof scanner>(null);
  const lastScanner = useRef<"PACKAGES" | "LOCATION">("PACKAGES");
  const [review, setReview] = useState(restored?.uncertain ?? false);
  const [uncertain, setUncertain] = useState(restored?.uncertain ?? false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [receiptId, setReceiptId] = useState<string | undefined>(
    restored?.receiptId,
  );
  const snapshot = useMemo(
    () => ({
      units,
      ...(location ? { location } : {}),
      sameSize,
      physical,
      uncertain,
      ...(receiptId ? { receiptId } : {}),
      locationMethod,
    }),
    [units, location, sameSize, physical, uncertain, receiptId, locationMethod],
  );
  useEffect(() => {
    const stored = drafts.write(key, snapshot);
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) setStorageWarning(!stored);
    });
    return () => {
      canceled = true;
    };
  }, [key, snapshot]);
  const resolving = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const expected = useQuery(
    fgRefs.getPallet,
    unitId
      ? { warehouseId, palletId: unitId, includeMoveHistory: false }
      : "skip",
  );
  const receipt = useQuery(
    fgRefs.getScanAssignment,
    receiptId ? { warehouseId, assignmentId: receiptId } : "skip",
  );
  const draft = useNavigationDraft({
    dirty: storageWarning && units.length > 0 && !receiptId,
    pending: op.busy,
    discard: () => {
      generation.current++;
      setUnits([]);
      setLocation(undefined);
      setReview(false);
    },
  });
  function scan(next: typeof scanner) {
    generation.current++;
    scannerRef.current = next;
    if (next) lastScanner.current = next;
    setScanner(next);
  }
  async function resolve(
    raw: string,
    target: "PACKAGES" | "LOCATION",
    fromCamera = false,
  ) {
    if (
      !canManage ||
      op.busy ||
      resolving.current ||
      receiptId ||
      (fromCamera && scannerRef.current !== target)
    )
      return;
    const token = generation.current;
    resolving.current = true;
    try {
      const outcome =
        target === "PACKAGES"
          ? await convex.query(fgRefs.resolvePackageCode, {
              warehouseId,
              code: raw,
            })
          : await convex.query(fgRefs.resolveLocationCode, {
              warehouseId,
              code: raw,
            });
      if (token !== generation.current) return;
      if (!outcome.ok) throw new Error("ACCESS_DENIED");
      const result = outcome.value;
      if (!result.ok) throw new Error(result.error.code);
      if ("unit" in result) {
        const unit = result.unit;
        if (unitId && !units.length && unit.id !== unitId)
          throw new Error("WRONG_ENTITY_TYPE");
        if (batchId && unit.batchId !== batchId)
          throw new Error("WRONG_ENTITY_TYPE");
        setUnits((current) =>
          current.some((item) => item.id === unit.id) || current.length >= 50
            ? current
            : [...current, { ...unit, fill: String(unit.fillPercent ?? 100) }],
        );
        setCode("");
      } else {
        setLocation(result.location);
        setLocationMethod(fromCamera ? "SCAN" : "MANUAL");
        setLocationCode(result.location.code);
        setPhysical(false);
      }
      op.setError("");
    } catch {
      if (token !== generation.current) return;
      op.setError(
        tr(
          "This label cannot be assigned. Check the package or storage code and try again.",
          "ไม่สามารถจัดเก็บด้วยฉลากนี้ ตรวจรหัสบรรจุภัณฑ์หรือพื้นที่แล้วลองอีกครั้ง",
        ),
      );
    } finally {
      resolving.current = false;
    }
  }
  const valid =
    units.length > 0 &&
    Boolean(location) &&
    units.every(
      (unit) =>
        Number.isInteger(Number(unit.fill)) &&
        Number(unit.fill) >= 1 &&
        Number(unit.fill) <= 100,
    );
  async function confirm() {
    if (!valid || !physical || !location || !canManage) return;
    const args = {
      warehouseId,
      units: units.map((unit) => ({
        unitId: unit.id,
        version: unit.version,
        fillPercent: Number(unit.fill),
      })),
      location: {
        zoneId: location.zoneId,
        ...(location.supportPositionId
          ? { supportPositionId: location.supportPositionId }
          : {}),
        version: location.version,
        code: location.code,
        method: locationMethod,
      },
      sameSize,
      physicalConfirmed: physical,
    };
    if (!drafts.write(key, { ...snapshot, uncertain: true })) {
      setStorageWarning(true);
      op.setError(
        tr(
          "Enable browser storage before confirming so this assignment can be recovered safely.",
          "เปิดการจัดเก็บข้อมูลในเบราว์เซอร์ก่อนยืนยัน เพื่อกู้การจัดเก็บนี้ได้อย่างปลอดภัย",
        ),
      );
      return;
    }
    setUncertain(true);
    await op.run(
      async () =>
        assign({ ...args, requestId: op.request(JSON.stringify(args)) }),
      (outcome) => {
        setUncertain(false);
        const id = written(outcome);
        op.clearRequests();
        generation.current++;
        scan(null);
        draft.settle();
        op.complete(() => {
          setReview(false);
          setReceiptId(id);
        });
      },
    );
  }
  const parent = unitId
    ? palletPath(unitId)
    : batchId
      ? batchPath(batchId)
      : FG_PATH;
  return (
    <PageContainer size="wide">
      <PageHeader
        title={tr("Assign package labels", "จัดเก็บบรรจุภัณฑ์ตามฉลาก")}
        backFallbackHref={parent}
        summary={tr(
          "Scan existing packages in top-to-bottom order, then verify their storage location. This records a location without measured coordinates.",
          "สแกนบรรจุภัณฑ์ที่มีอยู่จากบนลงล่าง แล้วตรวจตำแหน่งจัดเก็บ บันทึกตำแหน่งโดยไม่มีพิกัดที่วัด",
        )}
      />
      {!canManage ? (
        <ViewOnlyNotice />
      ) : receiptId ? (
        <section className="space-y-3" role="status">
          <h2 className="font-semibold">
            {tr("Packages stored", "บันทึกการจัดเก็บแล้ว")}
          </h2>
          <p>
            {receipt?.ok && receipt.value
              ? `${receipt.value.locationCode} · ${receipt.value.orderedUnitIds.length}`
              : tr("Loading receipt…", "กำลังโหลดใบยืนยัน…")}
          </p>
          <Button asChild variant="outline">
            <Link href={parent}>{tr("View inventory", "ดูสินค้าคงคลัง")}</Link>
          </Button>
        </section>
      ) : (
        <div className="max-w-3xl space-y-5">
          {unitId && (
            <p>
              {tr("Start with package", "เริ่มที่บรรจุภัณฑ์")}{" "}
              {expected?.ok ? (expected.value?.pallet.code ?? unitId) : unitId}
            </p>
          )}
          <fieldset disabled={op.busy || uncertain} className="space-y-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void resolve(code, "PACKAGES");
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <Field
                label={tr("Package code", "รหัสบรรจุภัณฑ์")}
                value={code}
                onChange={(value) => {
                  generation.current++;
                  setCode(value);
                }}
                required
                maxLength={500}
              />
              <Button type="submit" disabled={units.length >= 50}>
                {tr("Add package", "เพิ่มบรรจุภัณฑ์")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => scan("PACKAGES")}
              >
                {tr("Scan packages", "สแกนบรรจุภัณฑ์")}
              </Button>
            </form>
            <ol className="divide-y divide-border">
              {units.map((unit, index) => (
                <li
                  key={unit.id}
                  className="flex flex-wrap items-end gap-3 py-3"
                >
                  <p className="min-w-40 flex-1 break-words">
                    {index + 1}. {unit.code}
                    <span className="block text-sm text-muted">
                      {unit.productName}
                    </span>
                  </p>
                  <Field
                    label={tr("Fullness (%)", "ความเต็ม (%)")}
                    type="number"
                    min={1}
                    max={100}
                    step="1"
                    value={unit.fill}
                    onChange={(fill) =>
                      setUnits((current) =>
                        current.map((row) =>
                          row.id === unit.id ? { ...row, fill } : row,
                        ),
                      )
                    }
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      generation.current++;
                      setUnits((current) =>
                        current.filter((row) => row.id !== unit.id),
                      );
                    }}
                  >
                    {tr("Remove", "ลบ")}
                  </Button>
                </li>
              ))}
            </ol>
            <p className="text-sm text-muted">
              {tr(
                "Order is top to bottom. Remove and rescan a package to change its position.",
                "ลำดับจากบนลงล่าง หากต้องการเปลี่ยนลำดับให้ลบแล้วสแกนใหม่",
              )}
            </p>
            <label className="flex items-center gap-2">
              <CheckboxControl
                checked={sameSize}
                onChange={(event) => setSameSize(event.target.checked)}
              />
              {tr(
                "Packages are a similar size",
                "บรรจุภัณฑ์มีขนาดใกล้เคียงกัน",
              )}
            </label>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void resolve(locationCode, "LOCATION");
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <Field
                label={tr("Storage location code", "รหัสตำแหน่งจัดเก็บ")}
                value={locationCode}
                onChange={(value) => {
                  generation.current++;
                  setLocationCode(value);
                  setLocation(undefined);
                  setPhysical(false);
                }}
                required
                maxLength={500}
              />
              <Button type="submit">
                {tr("Verify location", "ตรวจตำแหน่ง")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => scan("LOCATION")}
              >
                {tr("Scan location", "สแกนตำแหน่ง")}
              </Button>
            </form>
            {location && (
              <p role="status">
                {location.code} · {location.name}
              </p>
            )}
            <Button
              disabled={!valid}
              onClick={() => {
                scan(null);
                setReview(true);
              }}
            >
              {tr("Review storage assignment", "ตรวจรายการจัดเก็บ")}
            </Button>
          </fieldset>
          <ErrorNotice message={op.error} />
          {storageWarning && (
            <p role="alert" className="text-sm text-warning">
              {tr(
                "Browser storage is unavailable. Keep this page open to retain the selected packages.",
                "เบราว์เซอร์เก็บข้อมูลไม่ได้ เปิดหน้านี้ไว้เพื่อรักษาบรรจุภัณฑ์ที่เลือก",
              )}
            </p>
          )}
          {uncertain && (
            <Button onClick={() => setReview(true)}>
              {tr("Recover assignment result", "กู้ผลการจัดเก็บ")}
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={scanner !== null}
        onOpenChange={(open) => {
          if (!op.busy && !receiptId) scan(open ? lastScanner.current : null);
        }}
      >
        <DialogContent closeLabel={tr("Close scanner", "ปิดเครื่องสแกน")}>
          <DialogHeader>
            <DialogTitle>
              {scanner === "LOCATION"
                ? tr("Scan location", "สแกนตำแหน่ง")
                : tr("Scan packages", "สแกนบรรจุภัณฑ์")}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "Use the existing inventory label.",
                "ใช้ฉลากสินค้าคงคลังที่มีอยู่",
              )}
            </DialogDescription>
          </DialogHeader>
          {scanner && (
            <BarcodeCameraBox
              key={scanner}
              mode={scanner}
              onCode={(raw) => void resolve(raw, scanner, true)}
              onClose={() => scan(null)}
              disabled={op.busy}
              closeControl={false}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={review}
        backPending={op.busy}
        onOpenChange={(open) => {
          if (!receiptId && !op.busy && (!uncertain || open)) setReview(open);
        }}
      >
        <DialogContent closeLabel={tr("Back to edit", "กลับไปแก้ไข")}>
          <DialogHeader>
            <DialogTitle>
              {tr("Confirm package storage", "ยืนยันการจัดเก็บบรรจุภัณฑ์")}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "Confirm the physical packages and top-to-bottom order before recording storage.",
                "ตรวจบรรจุภัณฑ์จริงและลำดับจากบนลงล่างก่อนบันทึก",
              )}
            </DialogDescription>
          </DialogHeader>
          <p>
            {location?.code} · {units.length}
          </p>
          <ol className="space-y-1 break-words">
            {units.map((unit, index) => (
              <li key={unit.id}>
                {index + 1}. {unit.code} · {unit.fill}%
              </li>
            ))}
          </ol>
          <label className="flex items-center gap-2">
            <CheckboxControl
              disabled={op.busy}
              checked={physical}
              onChange={(event) => setPhysical(event.target.checked)}
            />
            {tr(
              "I placed these packages at this location in the listed order.",
              "ฉันจัดเก็บบรรจุภัณฑ์ในตำแหน่งและลำดับนี้แล้ว",
            )}
          </label>
          <ErrorNotice message={op.error} />
          {uncertain && (
            <p role="status" className="text-sm text-muted">
              {tr(
                "Retry the same assignment to recover its result. The package list is held until the result is known.",
                "ลองคำสั่งจัดเก็บเดิมเพื่อกู้ผล รายการบรรจุภัณฑ์ถูกล็อกจนทราบผล",
              )}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={op.busy || uncertain}
              onClick={() => setReview(false)}
            >
              {tr("Back to edit", "กลับไปแก้ไข")}
            </Button>
            <Button
              disabled={op.busy || !physical || !valid}
              onClick={() => void confirm()}
            >
              {tr("Confirm stored", "ยืนยันจัดเก็บแล้ว")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
