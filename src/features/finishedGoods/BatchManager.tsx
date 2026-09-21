"use client";
import { resolveWriteError } from "@/lib/resolveWriteError";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useTranslations } from "next-intl";
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
import { StatusReason } from "@/components/ui/StatusReason";
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

import {
  newPackingRow as newRow,
  rowFromPackage,
  packedUnit,
  updatePackingRow,
  type PackingRow,
} from "./packingRows";
import { PackingDimensionFields } from "./PackingDimensionFields";

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
  const { t } = useFGText();
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
        closeLabel={t("copy.close")}
        showCloseButton={!editorState.busy}
        onEscapeKeyDown={(event) => {
          if (editorState.busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (editorState.busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("copy.batch-details")}</DialogTitle>
          <DialogDescription>
            {result?.ok && result.value
              ? `${result.value.batch.lot || batchId.slice(-8)} · ${result.value.batch.totalQuantity ?? "—"} ${result.value.product.unit}`
              : t("copy.storage-and-packing")}
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex flex-wrap gap-2 border-b border-border pb-3"
          role="group"
          aria-label={t("copy.batch-view")}
        >
          <Button
            variant={mode === "view" ? "secondary" : "ghost"}
            disabled={editorState.busy}
            onClick={() => setMode("view")}
            aria-pressed={mode === "view"}
          >
            <MapPin className="size-4" />
            <span className="text-sm">{t("copy.storage")}</span>
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
                  ? `${t("copy.edit-unit")} · ${result?.ok ? (result.value?.units.find((unit) => unit._id === unitId)?.code ?? "—") : "—"}`
                  : t("copy.edit-available-units")}
              </span>
            </Button>
          )}
        </div>
        {!result ? (
          <Loading />
        ) : !result.ok || !result.value ? (
          <ErrorNotice
            message={t("copy.unable-to-load-this-batch-close-and-try-again")}
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
              <DialogTitle>{t("copy.discard-packing-changes")}</DialogTitle>
              <DialogDescription>
                {t(
                  "copy.your-corrections-have-not-been-saved-keep-editing-to-finish-them-or-disc",
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setDiscardOpen(false)}>
                {t("copy.keep-editing")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  onClose();
                  if (pendingHref) router.push(pendingHref);
                }}
              >
                {t("copy.discard-changes")}
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
  const { t, locale } = useFGText();
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
        {t("copy.this-batch-has-no-active-units-yet")}
      </p>
    );
  const d = detail?.destination,
    p = detail?.placement;
  const action = unit.moveStatus
    ? t("copy.continue-move")
    : unit.status === "STORED"
      ? t("copy.move-unit")
      : unit.status === "RESERVED"
        ? t("copy.continue-storage")
        : unit.status === "AWAITING_MEASUREMENT"
          ? t("copy.measure-unit")
          : t("copy.find-storage");
  const locationOnly = p?.mode === "LOCATION_ONLY";
  const scanReady =
    !unit.moveStatus &&
    (unit.status === "AWAITING_MEASUREMENT" ||
      (unit.status === "AWAITING_PLACEMENT" && data.batch.simplePacking));
  const actionHref = scanReady
    ? "/finished-goods/scan"
    : locationOnly
      ? palletPath(unit._id)
      : unit.moveStatus || unit.status === "STORED"
        ? `${palletPath(unit._id)}/move`
        : unit.status === "RESERVED" || unit.status === "AWAITING_MEASUREMENT"
          ? palletPath(unit._id)
          : storagePath(unit._id);
  const lockMessages: Record<string, string> = {
    STORED: t(
      "copy.this-unit-is-already-stored-repacking-requires-a-physical-repacking-work",
    ),
    RESERVED: t(
      "copy.packing-is-locked-while-this-unit-has-a-storage-reservation-use-storage-",
    ),
    MOVING: t(
      "copy.packing-is-locked-while-this-unit-has-an-active-move-use-storage-to-cont",
    ),
    SUPPORTING: t(
      "copy.this-unit-supports-a-stack-review-the-upper-units-in-storage-stored-stoc",
    ),
  };
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[240px_1fr]">
      <div className="min-w-0">
        <p className="mb-2 text-xs text-muted">
          {t("copy.units")} · {data.units.length}
        </p>
        <div className="max-h-64 overflow-y-auto lg:max-h-[500px]">
          {data.units.map((u) => (
            <div key={u._id} className="flex items-start gap-1">
              <Button
                variant="ghost"
                type="button"
                aria-pressed={unit._id === u._id}
                onClick={() => setSelected(u._id)}
                className={`flex min-w-0 flex-1 flex-col gap-1 rounded-lg p-3 text-left text-sm ${unit._id === u._id ? "bg-selected text-selected-foreground ring-1 ring-link ring-inset" : "hover:bg-raised"}`}
              >
                <span className="font-medium break-words">
                  {u.code}{" "}
                  <span className="text-muted">
                    {u.quantity} {data.product.unit}
                  </span>
                </span>
                <span className="min-w-0 self-start [&>span]:whitespace-normal">
                  <Status value={palletDisplayStatus(u)} />
                </span>
              </Button>
              {canManage && !u.editable ? (
                <StatusReason
                  tone="locked"
                  label={`${t("copy.why-packing-is-locked")} · ${u.code}`}
                  message={
                    lockMessages[u.lockReason ?? ""] ??
                    t(
                      "copy.this-unit-is-unavailable-for-repacking-review-its-current-storage-operat",
                    )
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 space-y-4 [&>figure>svg]:sm:h-72">
        {!result ? (
          <Loading />
        ) : !detail ? (
          <ErrorNotice
            message={t(
              "copy.unable-to-load-the-unit-select-another-unit-or-retry",
            )}
          />
        ) : (
          <>
            {p?.mode === "LOCATION_ONLY" ? (
              <div className="space-y-2 rounded-xl border border-border p-5">
                <p className="font-semibold">
                  {t("copy.location")}: {p.positionCode}
                </p>
                <p>
                  {t("copy.top-to-bottom-position")}: {p.sequence}
                </p>
                <Button asChild variant="outline">
                  <Link href={palletPath(unit._id)}>
                    {t("copy.view-scanned-group")}
                  </Link>
                </Button>
              </div>
            ) : d && p ? (
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
                  {d.buildingCode} / {t("copy.floor")} {d.floorNumber} /{" "}
                  {d.locationName}
                  {d.supportCode ? ` / ${d.supportCode}` : ""}
                </p>
                <p className="font-mono text-xs text-muted">
                  X {p.xMm / 1000} m · Y {p.yMm / 1000} m · Z {p.zMm / 1000} m ·{" "}
                  {p.rotation}°
                </p>
                {unit.moveStatus && (
                  <p className="text-sm text-muted">
                    {t(
                      "copy.last-confirmed-position-open-the-move-to-see-its-reserved-destination",
                    )}
                  </p>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <MapPin className="mx-auto mb-3 size-6 text-muted" />
                <p>{t("copy.no-storage-position-yet")}</p>
                <p className="mt-2 text-sm text-muted">
                  {unit.quantity} {data.product.unit} ·{" "}
                  {unit.lengthMm
                    ? `${unit.lengthMm / 1000} × ${(unit.widthMm ?? 0) / 1000} × ${(unit.heightMm ?? 0) / 1000} m`
                    : t("copy.awaiting-measurement")}
                </p>
              </div>
            )}
            {!!detail.stackChildren?.length && (
              <p className="flex gap-2 text-sm text-muted">
                <LockKeyhole className="size-4 shrink-0" />
                {t("copy.move-the-upper-unit-before-moving-this-support")}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" asChild>
                <Link
                  href={palletPath(unit._id)}
                  onClick={(event) => onNavigate(event, palletPath(unit._id))}
                >
                  {t("copy.unit-details")}
                  <ArrowUpRight className="size-4" />
                </Link>
              </Button>
              {canManage && !detail.stackChildren?.length && (
                <Button asChild>
                  <Link
                    href={actionHref}
                    onClick={(event) => onNavigate(event, actionHref)}
                  >
                    {locationOnly
                      ? t("copy.view-scanned-group")
                      : scanReady
                        ? t("copy.scan-packages")
                        : action}
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

type EditRow = PackingRow & { originalCode?: string };
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
  const { t } = useFGText();
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
      originalCode: u.code,
      ...rowFromPackage({ ...u, dimensionsChecked: false }),
      id: u._id,
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
  const writeError = useTranslations("WriteError");
  const save = useMutation(batchManagementRefs.repackAvailable);
  const dirty =
    !done && (JSON.stringify(rows) !== originalRows || capacity !== "");
  useEffect(() => {
    onStateChange({ dirty, busy: op.busy });
  }, [dirty, op.busy, onStateChange]);
  const stale =
    data.batch.revision !== base.revision ||
    base.ids.some((id) => !data.units.some((u) => u._id === id && u.editable));
  const packages = rows.map((row) =>
    packedUnit(
      data.batch.simplePacking
        ? { ...row, fillPercent: row.fillPercent ?? "100" }
        : row,
    ),
  );
  const invalid = validatePacking(
    base.total,
    packages,
    data.product.unit,
    data.batch.simplePacking ? "SIMPLE" : "GEOMETRIC",
  );
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
          {t("copy.packing-updated")}
        </p>
        <p className="mt-2 text-sm text-muted">
          {t(
            "copy.stored-units-and-the-batch-total-are-unchanged-open-storage-to-view-the-",
          )}
        </p>
      </div>
    );
  if (!base.ids.length)
    return (
      <div className="py-8 text-center text-muted">
        {initialUnitId !== undefined
          ? t(
              "copy.this-unit-is-no-longer-available-for-correction-no-other-units-have-been",
            )
          : t(
              "copy.all-units-are-stored-reserved-moving-or-supporting-a-stack-use-storage-t",
            )}
      </div>
    );
  function update(id: string, changes: Partial<PackingRow>) {
    setReview(false);
    setRows((old) =>
      old.map((r) => (r.id === id ? updatePackingRow(r, changes) : r)),
    );
  }
  async function commit() {
    if (stale || invalid || !canManage) return;
    const args = {
      warehouseId,
      batchId: data.batch._id,
      expectedRevision: base.revision,
      unitIds: base.ids,
      ...(data.batch.simplePacking ? { simplePacking: true } : {}),
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
          {t("copy.correcting-unit")} · {base.unitCode}
        </h3>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span>
          {t("copy.batch-total")}{" "}
          <b>
            {data.batch.totalQuantity} {data.product.unit}
          </b>
        </span>
        <span>
          {t("copy.kept-unchanged")}{" "}
          <b>{(data.batch.totalQuantity ?? 0) - base.total}</b>
        </span>
        <span className="text-link">
          {t("copy.editing")} <b>{base.total}</b>
        </span>
      </div>
      <p className="text-xs text-muted">
        {initialUnitId !== undefined
          ? t(
              "copy.only-this-unit-will-be-replaced-all-other-units-their-codes-measurements",
            )
          : t(
              "copy.only-the-available-units-below-will-be-replaced-the-batch-total-and-all-",
            )}
      </p>
      {stale && (
        <ErrorNotice
          message={t(
            "copy.this-batch-or-its-storage-state-changed-close-and-reopen-to-load-current",
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
              label={t("copy.quantity-per-unit")}
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
            {t("copy.split")}
          </Button>
        </div>
        <div className="max-h-[42dvh] space-y-3 overflow-y-auto pr-1">
          {rows.map((r, i) => (
            <div
              key={r.id}
              ref={r.id === initialUnitId ? selectedRow : undefined}
              tabIndex={r.id === initialUnitId ? -1 : undefined}
              aria-label={r.originalCode ?? `${t("copy.new-unit")} ${i + 1}`}
              className={`rounded-lg border p-3 outline-none ${r.id === initialUnitId ? "border-link bg-selected ring-1 ring-link" : "border-border"}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-muted">
                  {r.originalCode
                    ? `${r.originalCode} · ${t("copy.replacement")}`
                    : `${t("copy.new-unit")} ${i + 1}`}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`${t("copy.remove-unit")} ${i + 1}`}
                  onClick={() => {
                    setRows(rows.filter((x) => x.id !== r.id));
                    setReview(false);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field
                  label={`${t("copy.quantity")} · ${i + 1}`}
                  type="number"
                  min={0.001}
                  step="0.001"
                  value={r.quantity}
                  onChange={(value) => update(r.id, { quantity: value })}
                />
                {data.batch.simplePacking ? (
                  <Field
                    label={`${t("copy.fullness")} · ${i + 1}`}
                    type="number"
                    min={1}
                    max={100}
                    step="1"
                    value={r.fillPercent ?? "100"}
                    onChange={(fillPercent) => update(r.id, { fillPercent })}
                  />
                ) : (
                  <PackingDimensionFields
                    row={r}
                    label={(field) =>
                      `${field === "length" ? t("copy.length-m") : field === "width" ? t("copy.width-m") : t("copy.height-m")} · ${i + 1}`
                    }
                    onChange={(changes) => update(r.id, changes)}
                  />
                )}
              </div>
              {!data.batch.simplePacking && (
                <label className="mt-3 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={r.checked}
                    onChange={(e) =>
                      update(r.id, { checked: e.target.checked })
                    }
                  />
                  {t("copy.actual-outside-dimensions-checked")} · {i + 1}
                </label>
              )}
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
          {t("copy.add-unit")}
        </Button>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p
          className={`text-sm ${allocatedMinor === totalMinor ? "text-success" : "text-danger"}`}
        >
          {t("copy.allocated")} {allocatedMinor / 1000} / {base.total}{" "}
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
          {t("copy.review-changes")}
        </Button>
      </div>
      {invalid && (
        <p className="text-xs text-muted">
          {resolveWriteError(invalid, writeError, "packing")}
        </p>
      )}
      {review && (
        <div
          role="region"
          aria-label={t("copy.confirm-repacking")}
          className="space-y-3 rounded-xl border border-border-strong bg-selected p-4"
        >
          <p>
            {t("copy.replace-available-units")}:{" "}
            <b>
              {base.ids.length} → {rows.length}
            </b>{" "}
            · {base.total} {data.product.unit}
          </p>
          <p className="text-sm text-muted">
            {t(
              "copy.original-unit-codes-remain-in-history-replacements-receive-new-codes",
            )}
          </p>
          <Button
            disabled={!!invalid || stale || op.busy || !canManage}
            onClick={() => void commit()}
          >
            {op.busy ? t("copy.saving") : t("copy.confirm-repacking")}
          </Button>
        </div>
      )}
      <ErrorNotice message={op.error} />
    </div>
  );
}
