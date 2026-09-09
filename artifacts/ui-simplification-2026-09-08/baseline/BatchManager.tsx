"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useQuery, useMutation } from "convex/react";
import {
  MapPin,
  Pencil,
  Plus,
  Trash2,
  ArrowUpRight,
  LockKeyhole,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import {
  batchManagementRefs,
  type ManagedBatch,
} from "@/lib/convex/batchManagementApi";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import {
  splitPackages,
  quantityToMinor,
  validatePacking,
  MAX_FG_PACKAGES,
} from "../../../convex/model/finishedGoods/packing";
import { PalletScene } from "./PalletScene";
import {
  Loading,
  ErrorNotice,
  Field,
  Status,
  palletDisplayStatus,
  palletPath,
  storagePath,
  useFGText,
  useCanManage,
  useOperation,
  useDraftKey,
  useUnsavedWarning,
  written,
} from "./shared";

type Mode = "view" | "edit";
type EditorState = { dirty: boolean; busy: boolean };
export function BatchManager({
  warehouseId,
  batchId,
  mode: initialMode,
  unitId,
  onClose,
}: {
  warehouseId: string;
  batchId: string;
  mode: Mode;
  unitId?: string | undefined;
  onClose: () => void;
}) {
  const { tr } = useFGText();
  const canManage = useCanManage();
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [hasEdited, setHasEdited] = useState(initialMode === "edit");
  const [editorState, setEditorState] = useState<EditorState>({
    dirty: false,
    busy: false,
  });
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useUnsavedWarning(editorState.dirty || editorState.busy);
  const reportEditorState = useCallback((next: EditorState) => {
    setEditorState(next);
  }, []);
  const requestClose = () => {
    if (editorState.busy) return;
    if (editorState.dirty) {
      setPendingHref(null);
      setDiscardOpen(true);
    } else onClose();
  };
  const guardNavigation = (
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => {
    if (editorState.busy) {
      event.preventDefault();
      return;
    }
    if (
      !editorState.dirty ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    setPendingHref(href);
    setDiscardOpen(true);
  };
  const result = useQuery(batchManagementRefs.get, { warehouseId, batchId });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto bg-surface sm:max-w-5xl"
        closeLabel={tr("Close", "ปิด")}
        showCloseButton={!editorState.busy}
        onEscapeKeyDown={(event) => {
          if (editorState.busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (editorState.busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {tr("Batch details", "รายละเอียดชุดจัดเตรียม")}
          </DialogTitle>
          <DialogDescription>
            {result?.ok && result.value
              ? `${result.value.batch.lot || batchId.slice(-8)} · ${result.value.batch.totalQuantity ?? "—"} ${result.value.product.unit}`
              : tr("Storage and packing", "การจัดเก็บและการบรรจุ")}
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex flex-wrap gap-2 border-b border-border pb-3"
          role="group"
          aria-label={tr("Batch view", "มุมมองชุดจัดเตรียม")}
        >
          <Button
            variant={mode === "view" ? "secondary" : "ghost"}
            disabled={editorState.busy}
            onClick={() => setMode("view")}
            aria-pressed={mode === "view"}
          >
            <MapPin className="size-4" />
            <span className="text-sm">{tr("Storage", "การจัดเก็บ")}</span>
          </Button>
          {canManage && (
            <Button
              variant={mode === "edit" ? "secondary" : "ghost"}
              disabled={editorState.busy}
              onClick={() => {
                setHasEdited(true);
                setMode("edit");
              }}
              aria-pressed={mode === "edit"}
            >
              <Pencil className="size-4" />
              <span className="text-sm">
                {unitId !== undefined
                  ? `${tr("Edit unit", "แก้ไขหน่วย")} · ${result?.ok ? (result.value?.units.find((unit) => unit._id === unitId)?.code ?? "—") : "—"}`
                  : tr("Edit available units", "แก้หน่วยที่ยังไม่จัดเก็บ")}
              </span>
            </Button>
          )}
        </div>
        {!result ? (
          <Loading />
        ) : !result.ok || !result.value ? (
          <ErrorNotice
            message={tr(
              "Unable to load this batch. Close and try again.",
              "โหลดชุดนี้ไม่สำเร็จ กรุณาปิดแล้วลองใหม่",
            )}
          />
        ) : (
          <>
            <div hidden={mode !== "view"}>
              <StorageView
                key={batchId}
                data={result.value}
                warehouseId={warehouseId}
                initialUnitId={unitId}
                onNavigate={guardNavigation}
              />
            </div>
            {hasEdited && (
              <div hidden={mode !== "edit"}>
                <AvailableEditor
                  key={`${batchId}:${unitId ?? "all"}`}
                  data={result.value}
                  warehouseId={warehouseId}
                  initialUnitId={unitId}
                  onStateChange={reportEditorState}
                />
              </div>
            )}
          </>
        )}
        <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <DialogContent showCloseButton={false} className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {tr("Discard packing changes?", "ทิ้งการแก้ไขการบรรจุหรือไม่?")}
              </DialogTitle>
              <DialogDescription>
                {tr(
                  "Your corrections have not been saved. Keep editing to finish them, or discard them to leave this batch.",
                  "การแก้ไขยังไม่ได้บันทึก แก้ไขต่อเพื่อทำให้เสร็จ หรือทิ้งการแก้ไขเพื่อออกจากชุดนี้",
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setDiscardOpen(false)}>
                {tr("Keep editing", "แก้ไขต่อ")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  onClose();
                  if (pendingHref) router.push(pendingHref);
                }}
              >
                {tr("Discard changes", "ทิ้งการแก้ไข")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
function StorageView({
  data,
  warehouseId,
  initialUnitId,
  onNavigate,
}: {
  data: ManagedBatch;
  warehouseId: string;
  initialUnitId?: string | undefined;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const { tr, locale } = useFGText();
  const canManage = useCanManage();
  const [selected, setSelected] = useState(
    initialUnitId ?? data.units[0]?._id ?? "",
  );
  const unit = data.units.find((p) => p._id === selected) ?? data.units[0];
  const result = useQuery(
    fgRefs.getPallet,
    unit ? { warehouseId, palletId: unit._id } : "skip",
  );
  const detail = result?.ok ? result.value : null;
  if (!unit)
    return (
      <p className="py-8 text-center text-muted">
        {tr(
          "This batch has no active units yet.",
          "ชุดนี้ยังไม่มีหน่วยจัดเก็บที่ใช้งานอยู่",
        )}
      </p>
    );
  const d = detail?.destination,
    p = detail?.placement;
  const action = unit.moveStatus
    ? tr("Continue move", "ดำเนินการย้ายต่อ")
    : unit.status === "STORED"
      ? tr("Move unit", "ย้ายตำแหน่ง")
      : unit.status === "RESERVED"
        ? tr("Continue storage", "ดำเนินการจัดเก็บต่อ")
        : unit.status === "AWAITING_MEASUREMENT"
          ? tr("Measure unit", "วัดขนาดหน่วย")
          : tr("Find storage", "เลือกจุดจัดเก็บ");
  const actionHref =
    unit.moveStatus || unit.status === "STORED"
      ? `${palletPath(unit._id)}/move`
      : unit.status === "RESERVED" || unit.status === "AWAITING_MEASUREMENT"
        ? palletPath(unit._id)
        : storagePath(unit._id);
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[240px_1fr]">
      <div className="min-w-0">
        <p className="mb-2 text-xs text-muted">
          {tr("Units", "หน่วยจัดเก็บ")} · {data.units.length}
        </p>
        <div className="max-h-64 overflow-y-auto lg:max-h-[500px]">
          {data.units.map((u) => (
            <button
              key={u._id}
              type="button"
              aria-pressed={unit._id === u._id}
              onClick={() => setSelected(u._id)}
              className={`flex w-full flex-col gap-1 rounded-lg p-3 text-left text-sm ${unit._id === u._id ? "bg-primary/10 ring-1 ring-primary/40 ring-inset" : "hover:bg-raised"}`}
            >
              <span className="font-medium">
                {u.code}{" "}
                <span className="float-right text-muted">
                  {u.quantity} {data.product.unit}
                </span>
              </span>
              <span className="self-start">
                <Status value={palletDisplayStatus(u)} />
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 space-y-4 [&>figure>svg]:sm:h-72">
        {!result ? (
          <Loading />
        ) : !detail ? (
          <ErrorNotice
            message={tr(
              "Unable to load the unit. Select another unit or retry.",
              "โหลดหน่วยนี้ไม่สำเร็จ กรุณาเลือกหน่วยอื่นหรือลองใหม่",
            )}
          />
        ) : (
          <>
            {d && p ? (
              <>
                <PalletScene
                  locale={locale}
                  storageFormat={unit.storageFormat ?? data.batch.storageFormat}
                  label={unit.code}
                  dimensions={{
                    widthMm: unit.widthMm ?? 0,
                    depthMm: unit.lengthMm ?? 0,
                    heightMm: unit.heightMm ?? 0,
                  }}
                  area={{
                    widthMm: d.zone.widthMm,
                    depthMm: d.zone.depthMm,
                    heightMm: d.zone.baseElevationMm + d.zone.maxStackHeightMm,
                  }}
                  support={d.support}
                  placement={{
                    xMm: p.xMm,
                    yMm: p.yMm,
                    zMm: p.zMm,
                    rotation: p.rotation,
                  }}
                  status={p.status === "STORED" ? "STORED" : "RESERVED"}
                  occupied={d.occupied.map((o) => ({
                    ...o,
                    id: o.placementId,
                    label: o.positionCode,
                  }))}
                />
                <p className="text-sm">
                  {d.buildingCode} / {tr("Floor", "ชั้น")} {d.floorNumber} /{" "}
                  {d.locationName}
                  {d.supportCode ? ` / ${d.supportCode}` : ""}
                </p>
                <p className="font-mono text-xs text-muted">
                  X {p.xMm / 1000} m · Y {p.yMm / 1000} m · Z {p.zMm / 1000} m ·{" "}
                  {p.rotation}°
                </p>
                {unit.moveStatus && (
                  <p className="text-sm text-muted">
                    {tr(
                      "Last confirmed position. Open the move to see its reserved destination.",
                      "ตำแหน่งที่ยืนยันล่าสุด เปิดงานย้ายเพื่อดูปลายทางที่จองไว้",
                    )}
                  </p>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <MapPin className="mx-auto mb-3 size-6 text-muted" />
                <p>
                  {tr(
                    "No storage position yet",
                    "ยังไม่ได้กำหนดตำแหน่งจัดเก็บ",
                  )}
                </p>
                <p className="mt-2 text-sm text-muted">
                  {unit.quantity} {data.product.unit} ·{" "}
                  {unit.lengthMm
                    ? `${unit.lengthMm / 1000} × ${(unit.widthMm ?? 0) / 1000} × ${(unit.heightMm ?? 0) / 1000} m`
                    : tr("Awaiting measurement", "รอวัดขนาด")}
                </p>
              </div>
            )}
            {!!detail.stackChildren?.length && (
              <p className="flex gap-2 text-sm text-muted">
                <LockKeyhole className="size-4 shrink-0" />
                {tr(
                  "Move the upper unit before moving this support.",
                  "ย้ายหน่วยด้านบนก่อนย้ายพาเลทรองรับนี้",
                )}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" asChild>
                <Link
                  href={palletPath(unit._id)}
                  onClick={(event) => onNavigate(event, palletPath(unit._id))}
                >
                  {tr("Unit details", "รายละเอียดหน่วย")}
                  <ArrowUpRight className="size-4" />
                </Link>
              </Button>
              {canManage && !detail.stackChildren?.length && (
                <Button asChild>
                  <Link
                    href={actionHref}
                    onClick={(event) => onNavigate(event, actionHref)}
                  >
                    {action}
                  </Link>
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type EditRow = {
  id: string;
  originalCode?: string;
  quantity: string;
  length: string;
  width: string;
  height: string;
  checked: boolean;
  weightKg?: number | undefined;
};
const newRow = (): EditRow => ({
  id: crypto.randomUUID(),
  quantity: "",
  length: "",
  width: "",
  height: "",
  checked: false,
});
function AvailableEditor({
  data,
  warehouseId,
  initialUnitId,
  onStateChange,
}: {
  data: ManagedBatch;
  warehouseId: string;
  initialUnitId?: string | undefined;
  onStateChange: (state: EditorState) => void;
}) {
  const { tr } = useFGText();
  const canManage = useCanManage();
  const initial = data.units.filter(
    (u) =>
      u.editable && (initialUnitId === undefined || u._id === initialUnitId),
  );
  const [base] = useState(() => ({
    revision: data.batch.revision,
    unitCode: initialUnitId === undefined ? undefined : initial[0]?.code,
    ids: initial.map((u) => u._id),
    total: initial.reduce((s, u) => s + u.quantity, 0),
  }));
  const [rows, setRows] = useState<EditRow[]>(() =>
    initial.map((u) => ({
      id: u._id,
      originalCode: u.code,
      quantity: String(u.quantity),
      length: u.lengthMm ? String(u.lengthMm / 1000) : "",
      width: u.widthMm ? String(u.widthMm / 1000) : "",
      height: u.heightMm ? String(u.heightMm / 1000) : "",
      checked: false,
      weightKg: u.weightKg,
    })),
  );
  const [originalRows] = useState(() => JSON.stringify(rows));
  const selectedRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Run after the dialog's initial focus so a directly opened unit is visible.
    const frame = requestAnimationFrame(() => {
      selectedRow.current?.focus({ preventScroll: true });
      selectedRow.current?.scrollIntoView?.({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialUnitId]);
  const [capacity, setCapacity] = useState("");
  const [review, setReview] = useState(false);
  const [done, setDone] = useState(false);
  const scope = useDraftKey("batch-available");
  const op = useOperation(`${scope}:${warehouseId}:${data.batch._id}`);
  const save = useMutation(batchManagementRefs.repackAvailable);
  const dirty =
    !done && (JSON.stringify(rows) !== originalRows || capacity !== "");
  useEffect(() => {
    onStateChange({ dirty, busy: op.busy });
  }, [dirty, op.busy, onStateChange]);
  const stale =
    data.batch.revision !== base.revision ||
    base.ids.some((id) => !data.units.some((u) => u._id === id && u.editable));
  const packages = rows.map((r) => ({
    quantity: Number(r.quantity),
    lengthMm: Math.round(Number(r.length) * 1000),
    widthMm: Math.round(Number(r.width) * 1000),
    heightMm: Math.round(Number(r.height) * 1000),
    dimensionsChecked: r.checked,
    ...(r.weightKg === undefined ? {} : { weightKg: r.weightKg }),
  }));
  const invalid = validatePacking(base.total, packages, data.product.unit);
  const allocatedMinor = packages.reduce(
    (sum, p) => sum + (quantityToMinor(p.quantity, data.product.unit) ?? 0),
    0,
  );
  const totalMinor = quantityToMinor(base.total, data.product.unit) ?? 0;
  const maxNewUnits = MAX_FG_PACKAGES - (data.units.length - base.ids.length);
  const split = splitPackages(base.total, Number(capacity), data.product.unit);
  if (done)
    return (
      <div className="py-10 text-center">
        <p className="font-semibold text-success">
          {tr("Packing updated", "แก้การบรรจุแล้ว")}
        </p>
        <p className="mt-2 text-sm text-muted">
          {tr(
            "Stored units and the batch total are unchanged. Open Storage to view the new units.",
            "หน่วยที่จัดเก็บและยอดรวมยังคงเดิม เปิดการจัดเก็บเพื่อดูหน่วยใหม่",
          )}
        </p>
      </div>
    );
  if (!base.ids.length)
    return (
      <div className="py-8 text-center text-muted">
        {initialUnitId !== undefined
          ? tr(
              "This unit is no longer available for correction. No other units have been selected. Close and reopen its details to check its current state.",
              "หน่วยนี้ไม่พร้อมให้แก้ไขแล้ว ระบบไม่ได้เลือกหน่วยอื่นแทน กรุณาปิดแล้วเปิดรายละเอียดอีกครั้งเพื่อตรวจสอบสถานะปัจจุบัน",
            )
          : tr(
              "All units are stored, reserved, moving or supporting a stack. Use Storage to continue the relevant operation.",
              "ทุกหน่วยจัดเก็บแล้ว ถูกจอง กำลังย้าย หรือรองรับกองซ้อน เปิดการจัดเก็บเพื่อดำเนินงานของหน่วยนั้น",
            )}
      </div>
    );
  function update(id: string, field: keyof EditRow, value: string | boolean) {
    setReview(false);
    setRows((old) =>
      old.map((r) =>
        r.id === id
          ? {
              ...r,
              [field]: value,
              ...(field !== "checked" ? { checked: false } : {}),
              ...(field === "quantity" ? { weightKg: undefined } : {}),
            }
          : r,
      ),
    );
  }
  async function commit() {
    if (stale || invalid || !canManage) return;
    const args = {
      warehouseId,
      batchId: data.batch._id,
      expectedRevision: base.revision,
      unitIds: base.ids,
      packages,
    };
    await op.run(async () => {
      written(
        await save({ ...args, requestId: op.request(JSON.stringify(args)) }),
      );
      setDone(true);
      op.clearRequests();
    });
  }
  return (
    <div className="space-y-4">
      {base.unitCode && (
        <h3 className="text-sm font-semibold">
          {tr("Correcting unit", "แก้ไขหน่วย")} · {base.unitCode}
        </h3>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span>
          {tr("Batch total", "ทั้งชุด")}{" "}
          <b>
            {data.batch.totalQuantity} {data.product.unit}
          </b>
        </span>
        <span>
          {tr("Kept unchanged", "คงเดิม")}{" "}
          <b>{(data.batch.totalQuantity ?? 0) - base.total}</b>
        </span>
        <span className="text-primary">
          {tr("Editing", "แก้ไข")} <b>{base.total}</b>
        </span>
      </div>
      <p className="text-xs text-muted">
        {initialUnitId !== undefined
          ? tr(
              "Only this unit will be replaced. All other units, their codes, measurements and stored positions stay unchanged.",
              "แทนที่เฉพาะหน่วยนี้ หน่วยอื่นทั้งหมด รหัส ขนาด และตำแหน่งจัดเก็บยังคงเดิม",
            )
          : tr(
              "Only the available units below will be replaced. The batch total and all other physical units stay unchanged.",
              "แทนที่เฉพาะหน่วยที่ยังไม่จัดเก็บด้านล่าง ยอดรวมและหน่วยอื่นที่มีอยู่คงเดิม",
            )}
      </p>
      {stale && (
        <ErrorNotice
          message={tr(
            "This batch or its storage state changed. Close and reopen to load current units.",
            "ชุดหรือสถานะจัดเก็บเปลี่ยนแล้ว กรุณาปิดแล้วเปิดใหม่เพื่อโหลดข้อมูลล่าสุด",
          )}
        />
      )}
      <fieldset
        disabled={stale || op.busy || !canManage}
        className="min-w-0 space-y-4"
      >
        <div className="flex items-end gap-2">
          <div className="max-w-48">
            <Field
              label={tr("Quantity per unit", "จำนวนต่อหน่วย")}
              type="number"
              min={0.001}
              step="any"
              value={capacity}
              onChange={setCapacity}
            />
          </div>
          <Button
            variant="outline"
            disabled={!split.length || split.length > maxNewUnits}
            onClick={() => {
              if (split.length) {
                setRows(
                  split.map((q) => ({ ...newRow(), quantity: String(q) })),
                );
                setReview(false);
              }
            }}
          >
            {tr("Split", "แบ่งใหม่")}
          </Button>
        </div>
        <div className="max-h-[42dvh] space-y-3 overflow-y-auto pr-1">
          {rows.map((r, i) => (
            <div
              key={r.id}
              ref={r.id === initialUnitId ? selectedRow : undefined}
              tabIndex={r.id === initialUnitId ? -1 : undefined}
              aria-label={
                r.originalCode ?? `${tr("New unit", "หน่วยใหม่")} ${i + 1}`
              }
              className={`rounded-lg border p-3 outline-none ${r.id === initialUnitId ? "border-primary/60 bg-primary/5 ring-1 ring-primary/20" : "border-border"}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-muted">
                  {r.originalCode
                    ? `${r.originalCode} · ${tr("Replacement", "หน่วยทดแทน")}`
                    : `${tr("New unit", "หน่วยใหม่")} ${i + 1}`}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`${tr("Remove unit", "ลบหน่วย")} ${i + 1}`}
                  onClick={() => {
                    setRows(rows.filter((x) => x.id !== r.id));
                    setReview(false);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    ["quantity", tr("Quantity", "จำนวน")],
                    ["length", tr("Length (m)", "ยาว (ม.)")],
                    ["width", tr("Width (m)", "กว้าง (ม.)")],
                    ["height", tr("Height (m)", "สูง (ม.)")],
                  ] as const
                ).map(([key, label]) => (
                  <Field
                    key={key}
                    label={`${label} · ${i + 1}`}
                    type="number"
                    min={0.001}
                    step="0.001"
                    value={r[key]}
                    onChange={(value) => update(r.id, key, value)}
                  />
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={r.checked}
                  onChange={(e) => update(r.id, "checked", e.target.checked)}
                />
                {tr(
                  "Actual outside dimensions checked",
                  "ตรวจสอบขนาดภายนอกจริงแล้ว",
                )}{" "}
                · {i + 1}
              </label>
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          disabled={rows.length >= maxNewUnits}
          onClick={() => {
            setRows([...rows, newRow()]);
            setReview(false);
          }}
        >
          <Plus className="size-4" />
          {tr("Add unit", "เพิ่มหน่วย")}
        </Button>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p
          className={`text-sm ${allocatedMinor === totalMinor ? "text-success" : "text-danger"}`}
        >
          {tr("Allocated", "จัดสรรแล้ว")} {allocatedMinor / 1000} / {base.total}{" "}
          {data.product.unit}
        </p>
        <Button
          disabled={
            !!invalid ||
            rows.length > maxNewUnits ||
            stale ||
            op.busy ||
            !canManage
          }
          onClick={() => setReview(true)}
        >
          {tr("Review changes", "ตรวจสอบการแก้ไข")}
        </Button>
      </div>
      {invalid && (
        <p className="text-xs text-muted">
          {tr(
            "Enter positive quantities and dimensions, keep the same total, and confirm each unit’s measurements.",
            "กรอกจำนวนและขนาดมากกว่าศูนย์ รักษายอดรวม และยืนยันขนาดจริงของทุกหน่วย",
          )}
        </p>
      )}
      {review && (
        <div
          role="region"
          aria-label={tr("Confirm repacking", "ยืนยันการแบ่งบรรจุ")}
          className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
        >
          <p>
            {tr("Replace available units", "แทนที่หน่วยที่ยังไม่จัดเก็บ")}:{" "}
            <b>
              {base.ids.length} → {rows.length}
            </b>{" "}
            · {base.total} {data.product.unit}
          </p>
          <p className="text-sm text-muted">
            {tr(
              "Original unit codes remain in history; replacements receive new codes.",
              "เก็บรหัสเดิมในประวัติ และสร้างรหัสใหม่ให้หน่วยทดแทน",
            )}
          </p>
          <Button
            disabled={!!invalid || stale || op.busy || !canManage}
            onClick={() => void commit()}
          >
            {op.busy
              ? tr("Saving…", "กำลังบันทึก…")
              : tr("Confirm repacking", "ยืนยันการแบ่งบรรจุ")}
          </Button>
        </div>
      )}
      <ErrorNotice message={op.error} />
    </div>
  );
}
