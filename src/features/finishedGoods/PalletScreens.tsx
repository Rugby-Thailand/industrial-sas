"use client";

import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  CheckCircle2,
  MapPin,
  Pencil,
  MoveRight,
  Layers3,
  LockKeyhole,
  Ruler,
  TriangleAlert,
} from "lucide-react";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Link, useRouter } from "@/i18n/navigation";
import { fgRefs, type PalletDetail } from "@/lib/convex/finishedGoodsApi";
import {
  PlacementEditor,
  DestinationSummary,
  sceneProps,
  correctionPath,
} from "./PlacementEditor";
export {
  PlacementEditor,
  DestinationSummary,
  sceneProps,
} from "./PlacementEditor";
import { PalletScene } from "./PalletScene";
import { usePreviewState } from "./usePreviewState";
import { DestinationScanner } from "./DestinationScanner";
import { DestinationPicker, destinationKey } from "./DestinationPicker";
export { destinationKey } from "./DestinationPicker";
import {
  ErrorNotice,
  Field,
  Heading,
  Loading,
  Missing,
  QR,
  Status,
  Steps,
  mmText,
  palletPath,
  palletDisplayStatus,
  panel,
  productPath,
  storagePath,
  useUnitText,
  useCanManage,
  useDraftKey,
  useOperation,
  useUnsavedWarning,
  written,
} from "./shared";

export function PalletScreen({
  palletId,
  view = "detail",
}: {
  palletId: string;
  view?: "measure" | "storage" | "detail";
}) {
  const draftScope = useDraftKey("fg-measure");
  if (!draftScope) return <Loading />;
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <PalletLoader
          key={`${draftScope}:${warehouseId}:${palletId}:${view}`}
          draftScope={draftScope}
          warehouseId={warehouseId}
          palletId={palletId}
          view={view}
        />
      )}
    </QueryGate>
  );
}
function PalletLoader({
  draftScope,
  warehouseId,
  palletId,
  view,
}: {
  draftScope: string;
  warehouseId: string;
  palletId: string;
  view: "measure" | "storage" | "detail";
}) {
  const canManage = useCanManage();
  const result = useQuery(fgRefs.getPallet, { warehouseId, palletId });
  if (!result) return <Loading />;
  if (!result.ok || !result.value || !result.value.product) return <Missing />;
  const detail = result.value;
  if (view === "measure" && detail.pallet.preparationBatchId)
    return <BatchMeasurementLink detail={detail} />;
  if (
    canManage &&
    view === "measure" &&
    detail.pallet.status !== "RESERVED" &&
    detail.pallet.status !== "STORED"
  )
    return (
      <Measurement
        draftScope={draftScope}
        warehouseId={warehouseId}
        detail={detail}
      />
    );
  if (canManage && view === "storage" && detail.pallet.status !== "STORED")
    return <Recommendations warehouseId={warehouseId} detail={detail} />;
  return <PalletDetailScreen warehouseId={warehouseId} detail={detail} />;
}
function BatchMeasurementLink({ detail }: { detail: PalletDetail }) {
  const { tr } = useUnitText(
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  return (
    <>
      <Heading title={tr("Packing and dimensions", "การบรรจุและขนาด")} />
      <Summary detail={detail} />
      <Notice
        title={tr(
          "Edit measurements in this preparation batch",
          "แก้ไขขนาดในชุดจัดเตรียมสินค้านี้",
        )}
        body={tr(
          "The batch is the single place to edit quantities and outside dimensions before storage.",
          "แก้จำนวนและขนาดภายนอกก่อนจัดเก็บที่ชุดเดิม เพื่อใช้ข้อมูลขนาดชุดเดียวกัน",
        )}
      >
        <Button asChild>
          <Link href={correctionPath(detail)}>
            {tr("Open preparation batch", "เปิดชุดจัดเตรียมสินค้า")}
          </Link>
        </Button>
      </Notice>
    </>
  );
}
export function Summary({
  detail,
  compact = false,
}: {
  detail: PalletDetail;
  compact?: boolean;
}) {
  const { tr } = useUnitText(
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const { pallet } = detail;
  const extraDetails = (
    <>
      {pallet.lengthMm && pallet.widthMm && pallet.heightMm ? (
        <span
          aria-label={tr(
            "Outer dimensions: length × width × height",
            "ขนาดภายนอก: ยาว × กว้าง × สูง",
          )}
        >
          {mmText(pallet.lengthMm)} × {mmText(pallet.widthMm)} ×{" "}
          {mmText(pallet.heightMm)}
        </span>
      ) : null}
      {pallet.lot ? (
        <span>
          {tr("Lot", "ล็อต")} {pallet.lot}
        </span>
      ) : null}
      <Status
        value={palletDisplayStatus({
          ...pallet,
          ...(detail.activeMove
            ? { moveStatus: detail.activeMove.status }
            : {}),
        })}
      />
    </>
  );
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
      <span className="font-mono font-semibold">{pallet.code}</span>
      <span>
        {detail.product?.sku} · {detail.product?.name}
      </span>
      <span>
        {pallet.quantity} {detail.product?.unit}
      </span>
      {compact ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">
            {tr("Details", "รายละเอียด")}
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {extraDetails}
          </div>
        </details>
      ) : (
        extraDetails
      )}
    </div>
  );
}

type MeasurementDraft = {
  quantity: string;
  lot: string;
  length: string;
  width: string;
  height: string;
  weight: string;
  unit: "m" | "cm";
  dimensionsChecked?: boolean;
};
function Measurement({
  draftScope,
  warehouseId,
  detail,
}: {
  draftScope: string;
  warehouseId: string;
  detail: PalletDetail;
}) {
  const { tr, locale } = useUnitText(
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const router = useRouter();
  const mutate = useMutation(fgRefs.saveMeasurement);
  const pallet = detail.pallet;
  const returnToPlacement =
    useSearchParams()?.get("returnToUnit") === pallet._id;
  const key = `${draftScope}:${warehouseId}:${pallet._id}`;
  const op = useOperation(
    key,
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const [form, setForm] = useState<MeasurementDraft>(() => {
    const fallback: MeasurementDraft = {
      quantity: String(pallet.quantity),
      lot: pallet.lot ?? "",
      length:
        pallet.lengthMm === undefined ? "" : String(pallet.lengthMm / 1000),
      width: pallet.widthMm === undefined ? "" : String(pallet.widthMm / 1000),
      height:
        pallet.heightMm === undefined ? "" : String(pallet.heightMm / 1000),
      weight: pallet.weightKg === undefined ? "" : String(pallet.weightKg),
      unit: "m",
    };
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return fallback;
      const d = parsed as Record<string, unknown>;
      if (
        ["quantity", "lot", "length", "width", "height", "weight"].every(
          (k) => typeof d[k] === "string",
        ) &&
        (d.unit === "m" || d.unit === "cm")
      )
        return {
          ...(d as MeasurementDraft),
          ...(pallet.packingBatchId || pallet.preparationBatchId
            ? { quantity: String(pallet.quantity) }
            : {}),
        };
    } catch {}
    return fallback;
  });
  const [dirty, setDirty] = useState(() => {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  });
  useUnsavedWarning(dirty);
  const factor = form.unit === "m" ? 1000 : 10;
  const dimensions = {
    widthMm: Math.round(Number(form.width) * factor),
    depthMm: Math.round(Number(form.length) * factor),
    heightMm: Math.round(Number(form.height) * factor),
  };
  const valid = [form.length, form.width, form.height, form.quantity].every(
    (v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0,
  );
  function update(next: MeasurementDraft) {
    if (
      ["quantity", "length", "width", "height"].some(
        (field) =>
          next[field as keyof MeasurementDraft] !==
          form[field as keyof MeasurementDraft],
      )
    )
      next = { ...next, dimensionsChecked: false };
    setForm(next);
    setDirty(true);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }
  function unit(next: "m" | "cm") {
    if (next === form.unit) return;
    const convert = (v: string) =>
      v.trim() === ""
        ? ""
        : String(Number((Number(v) * (next === "cm" ? 100 : 0.01)).toFixed(6)));
    update({
      ...form,
      unit: next,
      length: convert(form.length),
      width: convert(form.width),
      height: convert(form.height),
    });
  }
  async function save(find: boolean) {
    await op.run(async () => {
      if (find && !valid) throw new Error("INVALID_DIMENSIONS");
      if (
        valid &&
        Number(form.quantity) !== pallet.quantity &&
        !form.dimensionsChecked
      )
        throw new Error("DIMENSIONS_UNCHECKED");
      const args = {
        warehouseId,
        palletId: pallet._id,
        quantity: Number(form.quantity),
        lot: form.lot,
        ...(form.dimensionsChecked ? { dimensionsChecked: true } : {}),
        ...(form.length.trim() ? { lengthMm: dimensions.depthMm } : {}),
        ...(form.width.trim() ? { widthMm: dimensions.widthMm } : {}),
        ...(form.height.trim() ? { heightMm: dimensions.heightMm } : {}),
        ...(form.weight.trim() ? { weightKg: Number(form.weight) } : {}),
      };
      written(
        await mutate({ ...args, requestId: op.request(JSON.stringify(args)) }),
      );
      setDirty(false);
      op.clearRequests();
      try {
        localStorage.removeItem(key);
      } catch {}
      router.push(
        find || returnToPlacement
          ? storagePath(pallet._id)
          : palletPath(pallet._id),
      );
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save(true);
  }
  return (
    <>
      <Heading
        title={tr("Measure pallet", "วัดขนาดพาเลท")}
        back={
          returnToPlacement
            ? storagePath(pallet._id)
            : `${productPath(pallet.productId)}?resumePalletId=${encodeURIComponent(pallet._id)}`
        }
        backLabel={
          returnToPlacement
            ? tr("Return to placement", "กลับไปเลือกตำแหน่ง")
            : tr("Product details", "ข้อมูลสินค้า")
        }
        description={tr(
          "Measure the outside of the complete storage unit, including its pallet and packaging.",
          "วัดขนาดภายนอกของหน่วยจัดเก็บทั้งหมด รวมฐานพาเลทและบรรจุภัณฑ์",
        )}
      />
      <Steps step={2} />
      <Summary detail={detail} />
      <form onSubmit={submit} className="space-y-5">
        <fieldset disabled={op.busy} className="min-w-0 space-y-5">
          <ErrorNotice message={op.error} />
          <div className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
            <div className={panel}>
              <PalletScene
                storageFormat={
                  detail.pallet.storageFormat ?? detail.product?.storageFormat
                }
                dimensions={dimensions}
                locale={locale}
                label={pallet.code}
              />
              {!valid ? (
                <p className="mt-3 text-sm text-muted">
                  {tr(
                    "Enter length, width and height to see a measured preview.",
                    "กรอกความยาว ความกว้าง และความสูง เพื่อดูภาพตามขนาดจริง",
                  )}
                </p>
              ) : null}
            </div>
            <div className={`${panel} space-y-5`}>
              <h2 className="font-semibold">
                {tr("Physical pallet", "พาเลทจริง")}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={tr("Pallet ID", "รหัสพาเลท")}
                  value={pallet.code}
                  onChange={() => {}}
                  disabled
                />
                <Field
                  label={tr("Actual quantity", "จำนวนจริง")}
                  disabled={Boolean(
                    pallet.packingBatchId || pallet.preparationBatchId,
                  )}
                  {...(pallet.packingBatchId || pallet.preparationBatchId
                    ? {
                        hint: tr(
                          "Quantity is fixed by the saved packing allocation. You can still edit pending pallet measurements.",
                          "จำนวนถูกกำหนดจากการจัดสรรที่บันทึกแล้ว ยังแก้ไขขนาดพาเลทที่รอจัดเก็บได้",
                        ),
                      }
                    : {})}
                  value={form.quantity}
                  onChange={(quantity) => update({ ...form, quantity })}
                  type="number"
                  min={0.001}
                  step="any"
                  required
                />
                <div className="sm:col-span-2">
                  <Field
                    label={tr("Lot (optional)", "ล็อต (ไม่บังคับ)")}
                    value={form.lot}
                    onChange={(lot) => update({ ...form, lot })}
                    maxLength={100}
                  />
                </div>
              </div>
              <div className="border-t border-border pt-5">
                <h2 className="mb-3 font-semibold">
                  {tr("External dimensions", "ขนาดภายนอก")}
                </h2>
                <div
                  role="group"
                  aria-label={tr("Measurement unit", "หน่วยวัด")}
                  className="mb-4 grid grid-cols-2 gap-2"
                >
                  {(["m", "cm"] as const).map((v) => (
                    <Button
                      type="button"
                      key={v}
                      variant={form.unit === v ? "default" : "outline"}
                      aria-pressed={form.unit === v}
                      onClick={() => unit(v)}
                    >
                      {v === "m"
                        ? tr("Metres", "เมตร")
                        : tr("Centimetres", "เซนติเมตร")}
                    </Button>
                  ))}
                </div>
                <div className="grid gap-4">
                  {(["length", "width", "height"] as const).map((field) => (
                    <Field
                      key={field}
                      label={`${field === "length" ? tr("Length", "ความยาว") : field === "width" ? tr("Width", "ความกว้าง") : tr("Height", "ความสูง")} (${form.unit})`}
                      value={form[field]}
                      onChange={(v) => update({ ...form, [field]: v })}
                      type="number"
                      min={form.unit === "m" ? 0.001 : 0.1}
                      max={form.unit === "m" ? 100 : 10000}
                      step="any"
                      required
                    />
                  ))}
                  <Field
                    label={tr(
                      "Weight in kg (optional)",
                      "น้ำหนัก กก. (ไม่บังคับ)",
                    )}
                    value={form.weight}
                    onChange={(weight) => update({ ...form, weight })}
                    type="number"
                    min={0.001}
                    step="any"
                  />
                </div>
              </div>
            </div>
          </div>
          {Number(form.quantity) !== pallet.quantity && valid && (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={form.dimensionsChecked ?? false}
                onChange={(event) =>
                  update({ ...form, dimensionsChecked: event.target.checked })
                }
              />
              {tr(
                "I checked the outside dimensions again after changing the quantity.",
                "ตรวจสอบขนาดภายนอกอีกครั้งแล้วหลังเปลี่ยนจำนวนสินค้า",
              )}
            </label>
          )}
          <div className="flex flex-wrap justify-end gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={op.busy}
                onClick={() => void save(false)}
              >
                {tr("Save and exit", "บันทึกและออก")}
              </Button>
              <Button type="submit" disabled={op.busy || !valid}>
                <MapPin className="size-4" aria-hidden="true" />
                {op.busy
                  ? tr("Saving…", "กำลังบันทึก…")
                  : tr("Save and find storage", "บันทึกและหาจุดจัดเก็บ")}
              </Button>
            </div>
          </div>
        </fieldset>
      </form>
    </>
  );
}

function Recommendations({
  warehouseId,
  detail,
}: {
  warehouseId: string;
  detail: PalletDetail;
}) {
  const { tr } = useUnitText(
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const measured = !!(
    detail.pallet.lengthMm &&
    detail.pallet.widthMm &&
    detail.pallet.heightMm
  );
  const outcome = useQuery(
    fgRefs.recommend,
    measured ? { warehouseId, palletId: detail.pallet._id } : "skip",
  );
  const scope = useDraftKey("fg-destinations");
  const [selection, setSelection] = usePreviewState(
    scope ? `${scope}:${warehouseId}:${detail.pallet._id}` : undefined,
    {
      selected: "",
      showUnavailable: false as boolean,
      includeStacking: false as boolean,
    },
  );
  const { selected, showUnavailable, includeStacking } = selection;
  const setSelected = (selected: string) =>
    setSelection((previous) => ({ ...previous, selected }));
  if (!measured)
    return (
      <>
        <Heading
          title={tr(
            "Measure before choosing storage",
            "วัดขนาดก่อนเลือกจุดจัดเก็บ",
          )}
        />
        <Notice title={tr("Measurements are incomplete", "ยังวัดขนาดไม่ครบ")}>
          <Button asChild>
            <Link href={correctionPath(detail)}>
              {tr("Measure pallet", "วัดขนาดพาเลท")}
            </Link>
          </Button>
        </Notice>
      </>
    );
  if (!outcome) return <Loading />;
  if (!outcome.ok)
    return (
      <>
        <Heading
          title={tr("Recommended storage", "พื้นที่จัดเก็บที่แนะนำ")}
          back={correctionPath(detail)}
          backLabel={tr("Back to measurements", "กลับไปวัดขนาด")}
        />
        <Notice
          tone="danger"
          title={tr("Could not load recommendations", "โหลดคำแนะนำไม่สำเร็จ")}
          body={tr(
            "Your saved measurements are unchanged. Try loading again.",
            "ขนาดที่บันทึกไว้ยังคงเดิม กรุณาลองโหลดอีกครั้ง",
          )}
        >
          <Button onClick={() => window.location.reload()}>
            {tr("Try again", "ลองอีกครั้ง")}
          </Button>
        </Notice>
      </>
    );
  const validCandidates = outcome.value.candidates.filter(
    (c) => includeStacking || !c.supportPalletId,
  );
  const previews =
    "previewCandidates" in outcome.value ? outcome.value.previewCandidates : [];
  const keyOf = destinationKey;
  const candidates = [
    ...validCandidates,
    ...(showUnavailable
      ? previews
      : previews.filter((c) => keyOf(c) === selected)),
  ];
  const current = selected
    ? candidates.find((c) => keyOf(c) === selected)
    : candidates[0];
  const picker = (
    <DestinationPicker
      stateKey={
        scope
          ? `${scope}:${warehouseId}:${detail.pallet._id}:search`
          : undefined
      }
      candidates={candidates}
      selected={current ? keyOf(current) : ""}
      onSelect={setSelected}
      recommended={validCandidates[0]}
    />
  );
  return (
    <>
      <Heading
        title={tr("Recommended storage", "พื้นที่จัดเก็บที่แนะนำ")}
        back={correctionPath(detail)}
        backLabel={tr("Back to measurements", "กลับไปวัดขนาด")}
        description={tr(
          "A position that fits your measured unit, based on recorded space. Previewing does not reserve space or confirm storage.",
          "ตำแหน่งที่พอดีกับขนาดหน่วยจัดเก็บตามข้อมูลพื้นที่ในระบบ การดูตัวอย่างยังไม่จองพื้นที่หรือยืนยันจัดเก็บ",
        )}
      />
      <Summary detail={detail} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        {(detail.pallet.storageFormat ?? detail.product?.storageFormat) ===
          "PALLET" && (
          <Button
            variant="outline"
            aria-pressed={includeStacking}
            onClick={() => {
              setSelection((previous) => ({
                ...previous,
                includeStacking: !includeStacking,
              }));
              setSelected("");
            }}
          >
            {tr("Include pallet stacking", "รวมตำแหน่งซ้อนพาเลท")}
          </Button>
        )}
        {previews.length > 0 && (
          <Button
            variant="ghost"
            aria-pressed={showUnavailable}
            onClick={() => {
              setSelection((previous) => ({
                ...previous,
                showUnavailable: !showUnavailable,
              }));
              setSelected("");
            }}
          >
            {showUnavailable
              ? tr("Show fitting positions only", "แสดงเฉพาะตำแหน่งที่วางได้")
              : tr("Inspect unavailable areas", "ตรวจดูพื้นที่ที่ยังวางไม่ได้")}
          </Button>
        )}
        <span className="text-muted">
          {tr("Fitting positions", "ตำแหน่งที่วางได้")}:{" "}
          {validCandidates.length}
        </span>
      </div>
      {current && !validCandidates.some((c) => keyOf(c) === keyOf(current)) && (
        <div className="mb-4">
          <Notice
            tone="warning"
            title={tr(
              "Inspection only — no fitting position found here",
              "ภาพสำหรับตรวจสอบ — ยังไม่พบตำแหน่งที่วางได้ในพื้นที่นี้",
            )}
          />
        </div>
      )}
      {detail.pallet.status === "RESERVED" ? (
        <div className="mb-4">
          <Notice
            tone="warning"
            title={tr(
              "Your current spot stays reserved until a replacement is confirmed.",
              "จุดเดิมยังคงจองไว้จนกว่าจะยืนยันจุดใหม่",
            )}
          />
        </div>
      ) : null}
      {!current && selected && candidates.length > 0 ? (
        <div className="space-y-4">
          <Notice
            tone="warning"
            title={tr(
              "The previous location is no longer available. Select another destination to continue.",
              "จุดเดิมไม่พร้อมใช้งานแล้ว เลือกปลายทางใหม่เพื่อดำเนินการต่อ",
            )}
          />
          {picker}
        </div>
      ) : !current ? (
        <div className={`${panel} space-y-4 py-8`}>
          <TriangleAlert className="size-8 text-warning" aria-hidden="true" />
          <h2 className="text-xl font-semibold">
            {tr("No suitable space found", "ไม่พบพื้นที่ที่เหมาะสม")}
          </h2>
          <p className="max-w-2xl text-sm text-muted">
            {tr(
              "Only active buildings and available locations are considered. Check pallet dimensions, location height, existing occupancy and storage requirements.",
              "ระบบพิจารณาเฉพาะอาคารที่เปิดใช้งานและจุดที่ว่าง ตรวจสอบขนาดพาเลท ความสูง พาเลทที่มีอยู่ และเงื่อนไขจัดเก็บ",
            )}
          </p>
          <ul className="space-y-2 text-sm text-warning">
            {outcome.value.reasons.map((reason) => (
              <li key={reason}>{recommendationReason(reason, tr)}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={correctionPath(detail)}>
                {tr("Edit measurements", "แก้ไขขนาด")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/master-data/storage-layouts">
                {tr("Check storage layout", "ตรวจสอบผังจัดเก็บ")}
              </Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href={palletPath(detail.pallet._id)}>
                {tr("Save for later", "กลับมาจัดเก็บภายหลัง")}
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-4 2xl:grid-cols-[230px_1fr]">
          {picker}
          <PlacementEditor
            key={keyOf(current)}
            onActivate={() => setSelected(keyOf(current))}
            warehouseId={warehouseId}
            detail={detail}
            candidate={current}
            destinations={outcome.value.candidates}
          />
        </div>
      )}
    </>
  );
}
export function recommendationReason(
  code: string,
  tr: (en: string, th: string) => string,
) {
  const reasons: Record<string, readonly [string, string]> = {
    NO_ACTIVE_LOCATIONS: [
      "No active storage locations are available in this warehouse.",
      "คลังนี้ยังไม่มีจุดจัดเก็บที่เปิดใช้งาน",
    ],
    NO_FIT: [
      "The measured pallet does not fit the available space.",
      "พาเลทที่วัดไม่พอดีกับพื้นที่ว่าง",
    ],
    NO_AVAILABLE_SPACE: [
      "Available space is insufficient for this pallet.",
      "พื้นที่ว่างไม่เพียงพอสำหรับพาเลทนี้",
    ],
    MEASUREMENTS_REQUIRED: [
      "Save complete measurements first.",
      "กรุณาบันทึกขนาดให้ครบก่อน",
    ],
    STORAGE_CONDITION_MISMATCH: [
      "Storage conditions do not match.",
      "เงื่อนไขจัดเก็บไม่ตรงกัน",
    ],
    HEIGHT_EXCEEDED: [
      "The pallet is taller than the available clearance. Check its measured height or choose a taller storage location.",
      "พาเลทสูงเกินพื้นที่ว่าง กรุณาตรวจสอบความสูงที่วัดหรือเลือกจุดจัดเก็บที่สูงกว่า",
    ],
    NO_FREE_FOOTPRINT: [
      "No free position fits the pallet footprint. Check its length and width or make space in a suitable location.",
      "ไม่มีตำแหน่งว่างที่พอดีกับฐานพาเลท กรุณาตรวจสอบความยาวและความกว้าง หรือเตรียมพื้นที่ในจุดจัดเก็บที่เหมาะสม",
    ],
    NO_SUPPORT_SURFACE: [
      "No usable floor or shelf surface is available. Check the storage layout and its active positions.",
      "ไม่มีพื้นหรือชั้นวางที่ใช้ได้ กรุณาตรวจสอบผังและตำแหน่งจัดเก็บที่เปิดใช้งาน",
    ],
  };
  const text = reasons[code];
  return text
    ? tr(...text)
    : tr(
        "No valid position meets the current dimensions and storage constraints.",
        "ไม่มีตำแหน่งที่ตรงกับขนาดและข้อกำหนดการจัดเก็บในขณะนี้",
      );
}
function PalletDetailScreen({
  warehouseId,
  detail,
}: {
  warehouseId: string;
  detail: PalletDetail;
}) {
  const { tr, locale } = useUnitText(
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const canManage = useCanManage();
  const router = useRouter();
  const cancelMutation = useMutation(fgRefs.cancelReservation);
  const verifyMutation = useMutation(fgRefs.verifyDestination);
  const storeMutation = useMutation(fgRefs.confirmStored);
  const op = useOperation(
    undefined,
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const [cancel, setCancel] = useState(false);
  const [upperCode, setUpperCode] = useState("");
  const [physicalStack, setPhysicalStack] = useState(false);
  const pallet = detail.pallet;
  const destination = detail.destination;
  const placement = detail.placement;
  const stored = pallet.status === "STORED";
  const activeMove = detail.activeMove;
  const reserved = pallet.status === "RESERVED";
  const verified = detail.destinationVerifiedForCurrentUser;
  async function verify(code: string, method: "SCAN" | "MANUAL") {
    const result = await op.run(async () =>
      written(
        await verifyMutation({
          warehouseId,
          palletId: pallet._id,
          code,
          method,
          requestId: op.request(`verify:${placement?._id}:${code}:${method}`),
        }),
      ),
    );
    if (result === null) throw new Error("Verification failed");
    op.clearRequests();
  }
  async function store() {
    await op.run(async () => {
      written(
        await storeMutation({
          warehouseId,
          palletId: pallet._id,
          requestId: op.request(
            `store:${placement?._id}:${upperCode}:${physicalStack}`,
          ),
          ...(placement?.supportPalletId
            ? { palletCode: upperCode, physicalConfirmed: physicalStack }
            : {}),
        }),
      );
    });
  }
  async function release() {
    await op.run(async () => {
      written(
        await cancelMutation({
          warehouseId,
          palletId: pallet._id,
          requestId: op.request(`cancel:${placement?._id}`),
        }),
      );
      setCancel(false);
      router.push(storagePath(pallet._id));
    });
  }
  const coords = placement
    ? {
        xMm: placement.xMm,
        yMm: placement.yMm,
        zMm: placement.zMm,
        rotation: placement.rotation,
      }
    : undefined;
  return (
    <>
      <Heading
        title={
          activeMove
            ? activeMove.status === "IN_TRANSIT"
              ? tr("Pallet is moving", "กำลังย้ายพาเลท")
              : tr("Move prepared", "เตรียมย้ายแล้ว")
            : stored
              ? tr("Stored successfully", "จัดเก็บสำเร็จ")
              : reserved
                ? tr("Move pallet to storage", "นำพาเลทไปจัดเก็บ")
                : tr("Pallet details", "ข้อมูลพาเลท")
        }
        description={
          activeMove
            ? tr(
                "The source is the last confirmed position. Both spaces remain held until placement or return is confirmed.",
                "ต้นทางคือตำแหน่งที่ยืนยันล่าสุด ทั้งสองพื้นที่ยังถูกกันไว้จนกว่าจะยืนยันการวางหรือคืนต้นทาง",
              )
            : stored
              ? tr(
                  "The physical placement is confirmed and this space is occupied.",
                  "ยืนยันการวางพาเลทจริงแล้ว และบันทึกการใช้พื้นที่นี้",
                )
              : reserved
                ? tr(
                    "Follow the exact placement guide and verify the destination before confirming storage.",
                    "วางพาเลทตามตำแหน่งที่แสดง และตรวจสอบปลายทางก่อนยืนยันจัดเก็บ",
                  )
                : tr(
                    "Continue measuring or choosing a storage position when ready.",
                    "ดำเนินการวัดขนาดหรือเลือกตำแหน่งจัดเก็บต่อเมื่อพร้อม",
                  )
        }
      />
      <Summary detail={detail} />
      {!canManage ? (
        <div className="mb-5">
          <Notice
            title={tr("View-only access", "สิทธิ์ดูข้อมูลเท่านั้น")}
            body={tr(
              "You can view pallets and their storage positions. A warehouse manager can make changes.",
              "คุณดูข้อมูลพาเลทและตำแหน่งจัดเก็บได้ ผู้จัดการคลังสินค้าสามารถแก้ไขข้อมูลได้",
            )}
          />
        </div>
      ) : null}
      {!(reserved && canManage) && !cancel ? (
        <ErrorNotice message={op.error} />
      ) : null}
      {(reserved || stored) && !destination ? (
        <div className="mb-5">
          <Notice
            title={tr("Destination unavailable", "ไม่พบข้อมูลปลายทาง")}
            body={tr(
              "The pallet record is saved, but its destination cannot be displayed. Check the storage layout before moving it.",
              "ข้อมูลพาเลทยังถูกบันทึกอยู่ แต่ไม่สามารถแสดงปลายทางได้ กรุณาตรวจสอบผังก่อนเคลื่อนย้าย",
            )}
          />
        </div>
      ) : null}
      {activeMove ? (
        <div className="mb-5">
          <Notice
            tone="warning"
            title={
              activeMove.status === "IN_TRANSIT"
                ? tr("Pallet in transit", "พาเลทอยู่ระหว่างการย้าย")
                : tr(
                    "Destination reserved for a move",
                    "จองปลายทางเพื่อย้ายแล้ว",
                  )
            }
            {...(activeMove.issue ? { body: activeMove.issue } : {})}
          />
          <Button asChild className="mt-3">
            <Link href={`${palletPath(pallet._id)}/move`}>
              {canManage && activeMove.isOwner
                ? tr("Resume move", "ดำเนินการย้ายต่อ")
                : tr("View move", "ดูการย้าย")}
            </Link>
          </Button>
        </div>
      ) : null}
      {stored && !activeMove ? (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-4 text-success">
          <CheckCircle2 className="size-6" aria-hidden="true" />
          <span className="font-medium">
            {tr("Storage confirmed", "ยืนยันจัดเก็บแล้ว")}
          </span>
        </div>
      ) : null}
      {detail.supportPallet ? (
        <div className={`${panel} mb-5 text-sm`}>
          {tr("Supported by", "รองรับโดย")}{" "}
          <Link
            className="text-primary underline"
            href={palletPath(detail.supportPallet._id)}
          >
            {detail.supportPallet.code}
          </Link>
          {reserved ? (
            <p className="mt-2">
              {tr(
                "Verify this supporting pallet’s QR or code before confirming the stack.",
                "ตรวจสอบ QR หรือรหัสพาเลทรองรับก่อนยืนยันการซ้อน",
              )}
            </p>
          ) : null}
        </div>
      ) : null}
      {detail.stackChildren?.length ? (
        <div className={`${panel} mb-5 space-y-2 text-sm`}>
          <p className="flex items-center gap-2">
            <LockKeyhole className="size-4" />
            {tr(
              "Move locked — remove the upper pallet first",
              "ย้ายไม่ได้ — กรุณาย้ายพาเลทด้านบนก่อน",
            )}
          </p>
          {detail.stackChildren.map((child) => (
            <Link
              className="block text-primary underline"
              key={child._id}
              href={palletPath(child.palletId)}
            >
              {tr("View upper pallet", "ดูพาเลทด้านบน")} · {child.positionCode}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
        <div className={panel}>
          {destination && coords ? (
            <>
              <h2 className="mb-4 font-semibold">
                {activeMove?.status === "IN_TRANSIT"
                  ? `${tr("Last confirmed source", "ต้นทางที่ยืนยันล่าสุด")} · `
                  : ""}
                {destination.locationName}
              </h2>
              <PalletScene
                {...sceneProps(destination, detail)}
                placement={coords}
                status={
                  activeMove?.status === "IN_TRANSIT"
                    ? "SOURCE"
                    : stored
                      ? "STORED"
                      : "RESERVED"
                }
                locale={locale}
                label={pallet.code}
              />
            </>
          ) : (
            <PalletScene
              storageFormat={
                pallet.storageFormat ?? detail.product?.storageFormat
              }
              dimensions={{
                widthMm: pallet.widthMm ?? 0,
                depthMm: pallet.lengthMm ?? 0,
                heightMm: pallet.heightMm ?? 0,
              }}
              locale={locale}
              label={pallet.code}
            />
          )}
        </div>
        <div className="space-y-4">
          {destination && coords ? (
            <section
              className={panel}
              aria-labelledby="exact-destination-title"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="exact-destination-title"
                  className="flex items-center gap-2 font-semibold"
                >
                  <MapPin className="size-4" aria-hidden="true" />
                  {tr("Exact destination", "ปลายทางที่แน่นอน")}
                </h2>
                {canManage &&
                !activeMove &&
                !detail.stackChildren?.length &&
                (stored || reserved) ? (
                  <Button variant="outline" asChild>
                    <Link
                      href={
                        stored
                          ? `${palletPath(pallet._id)}/move`
                          : storagePath(pallet._id)
                      }
                    >
                      <MoveRight className="size-4" aria-hidden="true" />
                      {stored
                        ? tr("Move pallet", "ย้ายพาเลท")
                        : tr("Change storage position", "เปลี่ยนจุดจัดเก็บ")}
                    </Link>
                  </Button>
                ) : null}
              </div>
              <DestinationSummary
                destination={destination}
                placement={coords}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {canManage ? (
                  <Button variant="outline" asChild>
                    <Link
                      href={`/master-data/storage-layouts/${destination.buildingId}/floors/${destination.floorNumber}?editZone=${encodeURIComponent(destination.zoneId)}#storage-zone-${destination.zoneId}`}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      {tr("Edit location details", "แก้ไขข้อมูลจุดจัดเก็บ")}
                    </Link>
                  </Button>
                ) : null}
                <Button variant="ghost" asChild>
                  <Link
                    href={`/master-data/storage-layouts/${destination.buildingId}/floors/${destination.floorNumber}#storage-zone-${destination.zoneId}`}
                  >
                    <MapPin className="size-4" aria-hidden="true" />
                    {tr("View storage layout", "ดูผังจัดเก็บ")}
                  </Link>
                </Button>
              </div>
              {placement ? (
                <div className="mt-5 border-t border-border pt-4">
                  <QR
                    value={placement.qrValue}
                    label={placement.positionCode}
                  />
                </div>
              ) : null}
            </section>
          ) : null}
          <section className={`${panel} space-y-4`}>
            <h2 className="font-semibold">{tr("Pallet", "พาเลท")}</h2>
            <QR value={`ISAS:PALLET:1:${pallet._id}`} label={pallet.code} />
            <dl className="grid grid-cols-3 gap-3 text-sm">
              {[
                [tr("Length", "ยาว"), pallet.lengthMm],
                [tr("Width", "กว้าง"), pallet.widthMm],
                [tr("Height", "สูง"), pallet.heightMm],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-1 font-mono">
                    {typeof value === "number" ? mmText(value) : "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          {reserved && canManage ? (
            <section
              className={`${panel} space-y-4`}
              aria-label={tr(
                "Verify destination and placement",
                "ตรวจสอบปลายทางและการวาง",
              )}
            >
              <h2 className="font-semibold">
                {tr(
                  "Verify destination and placement",
                  "ตรวจสอบปลายทางและการวาง",
                )}
              </h2>
              <DestinationScanner
                storageFormat={
                  detail.pallet.storageFormat ?? detail.product?.storageFormat
                }
                expectedLocation={
                  detail.supportPallet?.code ?? destination?.locationName ?? ""
                }
                purpose={detail.supportPallet ? "SUPPORT" : "DESTINATION"}
                showVerificationErrors={false}
                onCode={verify}
                busy={op.busy}
                verified={verified}
              />
              {placement?.supportPalletId ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold">
                    {tr("Supporting pallet", "พาเลทรองรับ")}:{" "}
                    {detail.supportPallet?.code}
                  </p>
                  <Field
                    label={tr(
                      "Upper pallet code or QR",
                      "รหัสหรือ QR พาเลทด้านบน",
                    )}
                    value={upperCode}
                    onChange={setUpperCode}
                  />
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={physicalStack}
                      onChange={(e) => setPhysicalStack(e.target.checked)}
                    />
                    {tr(
                      "I placed this upper pallet on the support at the shown position.",
                      "ฉันวางพาเลทด้านบนบนพาเลทรองรับตามตำแหน่งที่แสดงแล้ว",
                    )}
                  </label>
                </div>
              ) : null}
              <p className="text-sm text-muted">
                {tr(
                  "Scanning verifies the location identity. Place the pallet at the exact highlighted position, then confirm below.",
                  "การสแกนตรวจสอบจุดจัดเก็บ กรุณาวางพาเลทตามตำแหน่งที่แสดง แล้วกดยืนยันด้านล่าง",
                )}
              </p>
              <ErrorNotice message={op.error} />
              <Button
                disabled={
                  !verified ||
                  op.busy ||
                  Boolean(
                    placement?.supportPalletId &&
                    (!physicalStack || !upperCode.trim()),
                  )
                }
                onClick={() => void store()}
              >
                {op.busy
                  ? tr("Saving…", "กำลังบันทึก…")
                  : tr("Confirm stored", "ยืนยันว่าจัดเก็บแล้ว")}
              </Button>
            </section>
          ) : null}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          {reserved && canManage ? (
            <>
              <Button
                variant="ghost"
                disabled={op.busy}
                onClick={() => {
                  op.setError("");
                  setCancel(true);
                }}
              >
                {tr("Cancel reservation", "ยกเลิกการจอง")}
              </Button>
            </>
          ) : stored ? (
            <>
              {canManage &&
              !activeMove &&
              destination &&
              !detail.stackChildren?.length &&
              (pallet.storageFormat ?? detail.product?.storageFormat) ===
                "PALLET" ? (
                <Button variant="outline" asChild>
                  <Link href={`${palletPath(pallet._id)}/stack`}>
                    <Layers3 className="size-4" />
                    {tr("Stack on top", "ซ้อนด้านบน")}
                  </Link>
                </Button>
              ) : null}
              {canManage ? (
                <Button variant="outline" asChild>
                  <Link href={productPath(pallet.productId)}>
                    {tr("Product and batches", "สินค้าและชุดจัดเตรียม")}
                  </Link>
                </Button>
              ) : null}
            </>
          ) : canManage && !reserved ? (
            <>
              <Button variant="outline" asChild>
                <Link href={correctionPath(detail)}>
                  <Ruler className="size-4" aria-hidden="true" />
                  {tr("Measure pallet", "วัดขนาดพาเลท")}
                </Link>
              </Button>
              {pallet.status === "AWAITING_PLACEMENT" ? (
                <Button asChild>
                  <Link href={storagePath(pallet._id)}>
                    {tr("Recommend storage", "แนะนำพื้นที่")}
                  </Link>
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <MoveHistory detail={detail} />
      <Dialog open={cancel && canManage && reserved} onOpenChange={setCancel}>
        <DialogContent closeLabel={tr("Close", "ปิด")}>
          <DialogHeader>
            <DialogTitle>
              {tr("Release this reserved space?", "คืนพื้นที่ที่จองไว้?")}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "The pallet returns to awaiting placement. Another operator can then use this space.",
                "พาเลทจะกลับไปรอเลือกจุดจัดเก็บ และผู้อื่นสามารถใช้พื้นที่นี้ได้",
              )}
            </DialogDescription>
          </DialogHeader>
          <ErrorNotice message={op.error} />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={op.busy}
              onClick={() => setCancel(false)}
            >
              {tr("Keep reservation", "เก็บการจองไว้")}
            </Button>
            <Button disabled={op.busy} onClick={() => void release()}>
              {tr("Release space", "คืนพื้นที่")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MoveHistory({ detail }: { detail: PalletDetail }) {
  const { tr, locale } = useUnitText(
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  if (!detail.moveHistory?.length) return null;
  return (
    <section className={`${panel} mt-5 space-y-3`}>
      <h2 className="font-semibold">
        {tr("Movement history", "ประวัติการย้าย")}
      </h2>
      <ul className="space-y-3">
        {detail.moveHistory.map((move) => (
          <li key={move._id} className="border-t border-border pt-3 text-sm">
            <p className="font-medium">
              {move.sourceDestination
                ? `${move.sourceDestination.buildingCode} · ${tr("Floor", "ชั้น")} ${move.sourceDestination.floorNumber} · ${move.sourceDestination.locationName}`
                : "—"}{" "}
              →{" "}
              {move.targetDestination
                ? `${move.targetDestination.buildingCode} · ${tr("Floor", "ชั้น")} ${move.targetDestination.floorNumber} · ${move.targetDestination.locationName}`
                : "—"}
            </p>
            <p className="mt-1 text-muted">
              {move.status === "COMPLETED"
                ? tr("Completed", "เสร็จสิ้น")
                : move.status === "RETURNED"
                  ? tr("Returned to source", "คืนต้นทางแล้ว")
                  : move.status === "CANCELLED"
                    ? tr("Cancelled", "ยกเลิกแล้ว")
                    : move.status === "IN_TRANSIT"
                      ? tr("In transit", "อยู่ระหว่างย้าย")
                      : tr("Prepared", "เตรียมย้ายแล้ว")}{" "}
              · {new Date(move.createdAt).toLocaleString(locale)}
            </p>
            {move.sourcePlacement && move.targetPlacement ? (
              <p className="mt-1 font-mono text-xs break-words text-muted">
                {move.sourcePlacement.positionCode}: X{" "}
                {mmText(move.sourcePlacement.xMm)} · Y{" "}
                {mmText(move.sourcePlacement.yMm)} · Z{" "}
                {mmText(move.sourcePlacement.zMm)} ·{" "}
                {move.sourcePlacement.rotation}° →{" "}
                {move.targetPlacement.positionCode}: X{" "}
                {mmText(move.targetPlacement.xMm)} · Y{" "}
                {mmText(move.targetPlacement.yMm)} · Z{" "}
                {mmText(move.targetPlacement.zMm)} ·{" "}
                {move.targetPlacement.rotation}°
              </p>
            ) : null}
            {move.reason ? <p className="mt-1">{move.reason}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
