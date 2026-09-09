"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Plus, Trash2, Copy, PackageCheck } from "lucide-react";
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
import { fgRefs, type Product } from "@/lib/convex/finishedGoodsApi";
import {
  MAX_FG_PACKAGES,
  quantityPrecision,
  quantityToMinor,
  splitPackages,
  splitEqually,
  validatePacking,
} from "../../../convex/model/finishedGoods/packing";
import { PalletScene } from "./PalletScene";
import {
  ErrorNotice,
  Field,
  Heading,
  Loading,
  Missing,
  ViewOnlyNotice,
  FG_PATH,
  panel,
  productPath,
  storagePath,
  useCanManage,
  useDraftKey,
  useFGText,
  useOperation,
  written,
} from "./shared";

import {
  newPackingRow as newRow,
  rowFromPackage,
  textNumber,
  millimetres as mm,
  packageDraft,
  packingIssueText,
  packedUnit,
  updatePackingRow,
  type PackingRow as Row,
  type PackageDraft,
} from "./packingRows";
import { PackingDimensionFields } from "./PackingDimensionFields";

type Format = "PALLET" | "BOX" | "OTHER";
type Mode = "CAPACITY" | "EQUAL" | "MANUAL";
type Batch = {
  _id: string;
  revision: number;
  status: "DRAFT" | "CREATED";
  totalQuantity?: number;
  storageFormat: Format;
  lot?: string;
  splitMode?: Mode;
  capacity?: number;
  unitCount?: number;
  packages: readonly PackageDraft[];
};
type Payload = {
  productId: string;
  batchId?: string;
  expectedRevision?: number;
  totalQuantity?: number;
  storageFormat: Format;
  lot?: string;
  splitMode: Mode;
  capacity?: number;
  unitCount?: number;
  packages: PackageDraft[];
  requestId: string;
};
type Draft = {
  total: string;
  capacity: string;
  count: string;
  storageFormat: Format;
  lot: string;
  mode: Mode;
  rows: Row[];
  selected: string;
  customized: boolean;
  splitPending: boolean;
  displayUnit: "m" | "cm";
  batchId?: string;
  revision?: number;
  pending?: { kind: "save" | "commit"; payload: Payload } | undefined;
  completed?: readonly string[];
  recoveryBlocked?: boolean;
};
function initialDraft(_product: Product, batch?: Batch): Draft {
  const rows = batch ? batch.packages.map(rowFromPackage) : [newRow()];
  return {
    total: textNumber(batch?.totalQuantity),
    capacity: textNumber(batch?.capacity),
    count: textNumber(batch?.unitCount ?? 2),
    storageFormat: batch?.storageFormat ?? "PALLET",
    lot: batch?.lot ?? "",
    mode: batch?.splitMode ?? "CAPACITY",
    rows,
    selected: rows[0]?.id ?? "",
    customized: Boolean(batch),
    splitPending: false,
    displayUnit: "m",
    ...(batch ? { batchId: batch._id, revision: batch.revision } : {}),
  };
}
function readDraft(key: string, fallback: Draft, productId: string): Draft {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return fallback;
    const draft = value as Draft;
    const invalid = () => ({ ...fallback, recoveryBlocked: true });
    if (
      ![
        draft.total,
        draft.capacity,
        draft.count,
        draft.selected,
        draft.lot,
      ].every((v) => typeof v === "string") ||
      !["PALLET", "BOX", "OTHER"].includes(draft.storageFormat) ||
      !["CAPACITY", "EQUAL", "MANUAL"].includes(draft.mode) ||
      !["m", "cm"].includes(draft.displayUnit) ||
      !Array.isArray(draft.rows) ||
      draft.rows.length > MAX_FG_PACKAGES ||
      !draft.rows.every(
        (row) =>
          row &&
          [
            row.id,
            row.quantity,
            row.length,
            row.width,
            row.height,
            row.weight,
          ].every((v) => typeof v === "string") &&
          typeof row.checked === "boolean",
      ) ||
      new Set(draft.rows.map((r) => r.id)).size !== draft.rows.length
    )
      return invalid();
    if (draft.pending) {
      const payload = draft.pending.payload;
      const allowed = new Set([
        "productId",
        "batchId",
        "expectedRevision",
        "totalQuantity",
        "storageFormat",
        "lot",
        "splitMode",
        "capacity",
        "unitCount",
        "packages",
        "requestId",
      ]);
      const packageKeys = new Set([
        "quantity",
        "lengthMm",
        "widthMm",
        "heightMm",
        "weightKg",
        "dimensionsChecked",
      ]);
      if (
        !["save", "commit"].includes(draft.pending.kind) ||
        !payload ||
        Object.keys(payload).some((k) => !allowed.has(k)) ||
        payload.productId !== productId ||
        payload.batchId !== draft.batchId ||
        payload.expectedRevision !== draft.revision ||
        (fallback.batchId && payload.batchId !== fallback.batchId) ||
        typeof payload.requestId !== "string" ||
        !/^[0-9a-f-]{36}$/.test(payload.requestId) ||
        !["PALLET", "BOX", "OTHER"].includes(payload.storageFormat) ||
        !["CAPACITY", "EQUAL", "MANUAL"].includes(payload.splitMode) ||
        (payload.lot !== undefined && typeof payload.lot !== "string") ||
        [
          payload.totalQuantity,
          payload.capacity,
          payload.unitCount,
          payload.expectedRevision,
        ].some(
          (v) =>
            v !== undefined && (typeof v !== "number" || !Number.isFinite(v)),
        ) ||
        !Array.isArray(payload.packages) ||
        payload.packages.length > MAX_FG_PACKAGES ||
        !payload.packages.every(
          (p) =>
            p &&
            Object.keys(p).every((k) => packageKeys.has(k)) &&
            typeof p.dimensionsChecked === "boolean" &&
            [p.quantity, p.lengthMm, p.widthMm, p.heightMm, p.weightKg].every(
              (v) =>
                v === undefined ||
                (typeof v === "number" && Number.isFinite(v)),
            ),
        )
      )
        return invalid();
    }
    if (
      draft.completed &&
      (!Array.isArray(draft.completed) ||
        !draft.completed.every((id) => typeof id === "string"))
    )
      return invalid();
    return draft;
  } catch {
    return { ...fallback, recoveryBlocked: true };
  }
}
const optionalNumber = (value: string) =>
  value.trim() ? Number(value) : undefined;
const batchPath = (id: string) => `${FG_PATH}/batches/${id}`;

export function PackingScreen({
  productId,
  batchId,
  draftToken,
}: {
  productId?: string;
  batchId?: string;
  draftToken?: string | undefined;
}) {
  const scope = useDraftKey("fg-batch-packing");
  if (!scope) return <Loading />;
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) =>
        batchId ? (
          <BatchLoader
            key={`${scope}:${warehouseId}:${batchId}`}
            scope={scope}
            warehouseId={warehouseId}
            batchId={batchId}
          />
        ) : productId ? (
          <ProductLoader
            key={`${scope}:${warehouseId}:${productId}:${draftToken ?? ""}`}
            scope={scope}
            warehouseId={warehouseId}
            productId={productId}
            draftToken={draftToken}
          />
        ) : (
          <Missing />
        )
      }
    </QueryGate>
  );
}
function ProductLoader({
  scope,
  warehouseId,
  productId,
  draftToken,
}: {
  scope: string;
  warehouseId: string;
  productId: string;
  draftToken?: string | undefined;
}) {
  const result = useQuery(fgRefs.getProduct, { warehouseId, productId });
  if (!result) return <Loading />;
  if (!result.ok || !result.value) return <Missing />;
  return (
    <PackingForm
      scope={scope}
      warehouseId={warehouseId}
      product={result.value}
      draftToken={draftToken}
    />
  );
}
function BatchLoader({
  scope,
  warehouseId,
  batchId,
}: {
  scope: string;
  warehouseId: string;
  batchId: string;
}) {
  const result = useQuery(fgRefs.getBatch, { warehouseId, batchId });
  if (!result) return <Loading />;
  if (!result.ok || !result.value) return <Missing />;
  const { batch, product, editable, blockedReason } = result.value;
  return (
    <PackingForm
      scope={scope}
      warehouseId={warehouseId}
      product={product}
      batch={batch}
      batchEditable={editable}
      blockedReason={blockedReason}
    />
  );
}
function PackingForm({
  scope,
  warehouseId,
  product,
  batch,
  batchEditable = true,
  blockedReason,
  draftToken,
}: {
  scope: string;
  warehouseId: string;
  product: Product;
  batch?: Batch;
  batchEditable?: boolean;
  blockedReason?: string | undefined;
  draftToken?: string | undefined;
}) {
  const { tr, locale } = useFGText();
  const router = useRouter();
  const canManage = useCanManage();
  const key = `${scope}:${warehouseId}:${batch ? `batch:${batch._id}` : `new:${product._id}${draftToken ? `:${draftToken}` : ""}`}`;
  const op = useOperation(key);
  const saveBatchDraft = useMutation(fgRefs.saveBatchDraft);
  const commitBatch = useMutation(fgRefs.commitBatch);
  const [draft, setDraft] = useState(() =>
    canManage
      ? readDraft(key, initialDraft(product, batch), product._id)
      : initialDraft(product, batch),
  );
  const completedBatchResult = useQuery(
    fgRefs.getBatch,
    !batch && draft.completed && draft.batchId
      ? { warehouseId, batchId: draft.batchId }
      : "skip",
  );
  const currentBatch =
    batch ??
    (completedBatchResult?.ok ? completedBatchResult.value?.batch : undefined);
  const completionStale = Boolean(
    draft.completed &&
    currentBatch &&
    currentBatch.revision > (draft.revision ?? 0),
  );
  const [localError, setLocalError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [saved, setSaved] = useState(false);
  const [review, setReview] = useState(false);
  const [copyTargets, setCopyTargets] = useState<string[]>([]);
  const noun =
    draft.storageFormat === "PALLET"
      ? tr("pallet", "พาเลท")
      : draft.storageFormat === "BOX"
        ? tr("box", "กล่อง")
        : tr("storage unit", "หน่วยจัดเก็บ");
  const plural =
    draft.storageFormat === "PALLET"
      ? tr("pallets", "พาเลท")
      : draft.storageFormat === "BOX"
        ? tr("boxes", "กล่อง")
        : tr("storage units", "หน่วยจัดเก็บ");
  const rowName = (i: number) => `${noun} ${i + 1}`;
  const selected =
    draft.rows.find((r) => r.id === draft.selected) ?? draft.rows[0];
  const packages = draft.rows.map(packageDraft);
  const issue = validatePacking(
    Number(draft.total),
    draft.rows.map(packedUnit),
    product.unit,
  );
  const preview =
    draft.mode === "CAPACITY"
      ? splitPackages(Number(draft.total), Number(draft.capacity), product.unit)
      : draft.mode === "EQUAL"
        ? splitEqually(Number(draft.total), Number(draft.count), product.unit)
        : draft.rows.map((r) => Number(r.quantity));
  const totalMinor = quantityToMinor(Number(draft.total), product.unit);
  const values = draft.rows.map((r) =>
    quantityToMinor(Number(r.quantity), product.unit),
  );
  const allocatedMinor = values.every((v) => v !== null)
    ? values.reduce<number>((a, v) => a + (v ?? 0), 0)
    : null;
  const remaining =
    totalMinor !== null && allocatedMinor !== null
      ? (totalMinor - allocatedMinor) / 1000
      : null;
  const stale = Boolean(
    batch &&
    draft.revision !== batch.revision &&
    !draft.pending &&
    !draft.completed,
  );
  const editable =
    canManage &&
    product.status === "ACTIVE" &&
    batchEditable &&
    !op.busy &&
    !draft.pending &&
    !stale;
  const dimensionLabel = (field: "length" | "width" | "height") =>
    `${field === "length" ? tr("Length", "ความยาว") : field === "width" ? tr("Width", "ความกว้าง") : tr("Height", "ความสูง")} (${draft.displayUnit === "m" ? tr("m", "ม.") : tr("cm", "ซม.")})`;
  const issueText = packingIssueText(issue, tr);
  function persist(next: Draft, required = false) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setStorageWarning(false);
    } catch {
      setStorageWarning(true);
      if (required) return false;
    }
    setDraft(next);
    setSaved(false);
    return true;
  }
  function revise(changes: Partial<Draft>) {
    const next = { ...draft, ...changes };
    if (next.mode === "MANUAL") {
      persist({ ...next, splitPending: false });
      return;
    }
    const q =
      next.mode === "CAPACITY"
        ? splitPackages(Number(next.total), Number(next.capacity), product.unit)
        : splitEqually(Number(next.total), Number(next.count), product.unit);
    const changed =
      q.length !== next.rows.length ||
      q.some((n, i) => n !== Number(next.rows[i]?.quantity));
    if (!next.customized && q.length) {
      const rows = q.map((n) => newRow(String(n)));
      persist({
        ...next,
        rows,
        selected: rows[0]?.id ?? "",
        splitPending: false,
      });
    } else persist({ ...next, splitPending: changed });
  }
  function updateRow(id: string, changes: Partial<Row>) {
    if (!editable) return;
    setLocalError("");
    persist({
      ...draft,
      customized: true,
      ...("quantity" in changes
        ? { mode: "MANUAL" as const, splitPending: false }
        : {}),
      rows: draft.rows.map((r) =>
        r.id === id ? updatePackingRow(r, changes) : r,
      ),
    });
  }
  function applySplit() {
    if (!preview.length) return;
    const rows = preview.map((q) => newRow(String(q)));
    persist({
      ...draft,
      rows,
      selected: rows[0]?.id ?? "",
      splitPending: false,
      customized: false,
    });
    setCopyTargets([]);
  }
  function payload(): Payload {
    const totalQuantity = optionalNumber(draft.total),
      capacity = optionalNumber(draft.capacity),
      unitCount = optionalNumber(draft.count);
    return {
      productId: product._id,
      ...(draft.batchId
        ? { batchId: draft.batchId, expectedRevision: draft.revision! }
        : {}),
      ...(totalQuantity === undefined ? {} : { totalQuantity }),
      storageFormat: draft.storageFormat,
      ...(draft.lot.trim() ? { lot: draft.lot.trim() } : {}),
      splitMode: draft.mode,
      ...(draft.mode === "CAPACITY" && capacity !== undefined
        ? { capacity }
        : {}),
      ...(draft.mode === "EQUAL" && unitCount !== undefined
        ? { unitCount }
        : {}),
      packages,
      requestId: crypto.randomUUID(),
    };
  }
  async function send(kind: "save" | "commit") {
    if (!canManage || op.busy || (!draft.pending && !editable)) return;
    if (!draft.pending && kind === "commit" && (issue || draft.splitPending)) {
      setLocalError(
        issueText || tr("Apply the new split first.", "ใช้การแบ่งใหม่ก่อน"),
      );
      return;
    }
    const pending = draft.pending ?? { kind, payload: payload() };
    if (!draft.pending && !persist({ ...draft, pending }, true)) {
      setLocalError(
        tr(
          "Enable browser storage before saving so retries cannot create duplicates.",
          "เปิดพื้นที่บันทึกเบราว์เซอร์ก่อนบันทึก เพื่อป้องกันข้อมูลซ้ำเมื่อลองใหม่",
        ),
      );
      return;
    }
    const result = await op.run(async () => {
      const outcome = await (
        pending.kind === "save" ? saveBatchDraft : commitBatch
      )({ ...pending.payload, warehouseId });
      if (outcome.ok && !outcome.value.written)
        persist({ ...draft, pending: undefined });
      written(outcome);
      return outcome.ok && outcome.value.written ? outcome.value : null;
    });
    if (!result) return;
    setReview(false);
    const next: Draft = {
      ...draft,
      pending: undefined,
      batchId: result.batchId,
      revision: result.revision,
      ...(pending.kind === "commit" ? { completed: result.palletIds } : {}),
    };
    persist(next);
    setSaved(true);
    setLocalError("");
    op.clearRequests();
    if (!batch && pending.kind === "save") {
      try {
        localStorage.setItem(
          `${scope}:${warehouseId}:batch:${result.batchId}`,
          JSON.stringify(next),
        );
        localStorage.removeItem(key);
      } catch {
        setStorageWarning(true);
      }
      router.replace(batchPath(result.batchId));
    }
  }
  if (!canManage)
    return (
      <>
        <Heading title={tr("Packing and dimensions", "แบ่งบรรจุและวัดขนาด")} />
        <ViewOnlyNotice />
      </>
    );
  if (draft.recoveryBlocked)
    return (
      <>
        <Heading
          title={tr(
            "Saved batch needs recovery",
            "ต้องกู้คืนข้อมูลชุดที่บันทึกไว้",
          )}
        />
        <Notice
          tone="warning"
          title={tr(
            "Check existing batches before starting again.",
            "ตรวจสอบชุดที่มีอยู่ก่อนเริ่มใหม่ เพื่อไม่สร้างรายการซ้ำ",
          )}
        />
        <Button asChild>
          <Link href={productPath(product._id)}>
            {tr("Review product batches", "ตรวจสอบชุดของสินค้า")}
          </Link>
        </Button>
      </>
    );
  if (
    draft.completed &&
    !batch &&
    draft.batchId &&
    completedBatchResult === undefined
  )
    return <Loading />;
  if (draft.completed && !currentBatch) return <Missing />;
  if (completionStale)
    return (
      <>
        <Heading
          title={tr("This batch has changed", "ชุดนี้มีการเปลี่ยนแปลงแล้ว")}
          description={`${product.sku} · ${product.name}`}
        />
        <Notice
          tone="warning"
          title={tr(
            "A newer packing revision is available.",
            "มีการแบ่งบรรจุฉบับใหม่แล้ว",
          )}
          body={tr(
            "The previous result is part of history. Load the latest batch before choosing storage so replaced units are not used.",
            "ผลเดิมอยู่ในประวัติแล้ว โหลดชุดล่าสุดก่อนเลือกที่จัดเก็บ เพื่อไม่ใช้หน่วยที่ถูกแทนที่",
          )}
        >
          <Button
            onClick={() => {
              if (batch) persist(initialDraft(product, batch));
              else if (currentBatch) router.push(batchPath(currentBatch._id));
            }}
          >
            {tr("Load latest batch", "โหลดชุดล่าสุด")}
          </Button>
        </Notice>
      </>
    );
  if (draft.completed)
    return (
      <>
        <Heading
          title={tr("Storage units created", "สร้างหน่วยจัดเก็บแล้ว")}
          description={`${product.sku} · ${product.name}`}
        />
        <div className={`${panel} space-y-4`}>
          <PackageCheck className="size-8 text-success" />
          <p>
            {draft.total} {product.unit} · {draft.completed.length} {plural}
          </p>
          <p>
            {tr(
              "Choose an exact storage position for each unit.",
              "เลือกตำแหน่งจัดเก็บที่แน่นอนของแต่ละหน่วย",
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {draft.completed.map((id, i) => (
              <Button asChild variant="outline" key={id}>
                <Link href={storagePath(id)}>
                  {tr("Find storage", "เลือกที่จัดเก็บ")} · {rowName(i)}
                </Link>
              </Button>
            ))}
          </div>
          <Button asChild variant="outline">
            <Link href={productPath(product._id)}>
              {tr("Product and batches", "สินค้าและชุดจัดเตรียม")}
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (batch) persist(initialDraft(product, batch));
              else if (draft.batchId) router.push(batchPath(draft.batchId));
            }}
          >
            {tr("Review or edit this batch", "ตรวจสอบหรือแก้ชุดนี้")}
          </Button>
          <Button
            onClick={() => {
              const blank = initialDraft(product);
              if (!batch) persist(blank);
              else {
                try {
                  localStorage.setItem(
                    `${scope}:${warehouseId}:new:${product._id}`,
                    JSON.stringify(blank),
                  );
                } catch {
                  setStorageWarning(true);
                  return;
                }
                router.push(`${productPath(product._id)}/packing`);
              }
            }}
          >
            {tr("Prepare another batch", "จัดเตรียมสินค้าอีกชุด")}
          </Button>
        </div>
      </>
    );
  return (
    <>
      <Heading
        title={
          batch?.status === "CREATED"
            ? tr("Edit batch packing", "แก้การแบ่งบรรจุของชุด")
            : tr("Packing and dimensions", "แบ่งบรรจุและวัดขนาด")
        }
        description={`${product.sku} · ${product.name} · ${product.unit}`}
        back={productPath(product._id)}
        backLabel={tr("Product details", "ข้อมูลสินค้า")}
      />
      <div className="space-y-5">
        {!review && <ErrorNotice message={localError || op.error} />}
        {product.status !== "ACTIVE" && (
          <Notice
            tone="warning"
            title={tr(
              "Activate this product before preparing a batch.",
              "เปิดใช้งานสินค้าก่อนจัดเตรียมชุด",
            )}
          />
        )}
        {!batchEditable && (
          <Notice
            tone="warning"
            title={tr(
              "This batch cannot be repacked while its units are reserved, moving or stored.",
              "ชุดนี้แบ่งใหม่ไม่ได้ขณะมีหน่วยจองพื้นที่ กำลังย้าย หรือจัดเก็บแล้ว",
            )}
            body={
              blockedReason
                ? tr(
                    "Finish the move or release reservations first. Stored units require a physical repacking workflow.",
                    "ทำงานย้ายให้เสร็จหรือยกเลิกการจองก่อน หน่วยที่จัดเก็บแล้วต้องผ่านงานแบ่งบรรจุจริง",
                  )
                : ""
            }
          />
        )}
        {stale && (
          <Notice
            tone="warning"
            title={tr(
              "This batch changed in another session.",
              "ชุดนี้มีการแก้ไขจากอีกหน้าต่าง",
            )}
          >
            <Button onClick={() => persist(initialDraft(product, batch))}>
              {tr("Load latest batch", "โหลดชุดล่าสุด")}
            </Button>
          </Notice>
        )}
        {storageWarning && (
          <Notice
            tone="warning"
            title={tr(
              "Local recovery could not be saved.",
              "ไม่สามารถบันทึกข้อมูลกู้คืนในเบราว์เซอร์",
            )}
          />
        )}
        {saved && (
          <p role="status" className="text-success">
            {tr(
              "Draft saved. No storage units have been created.",
              "บันทึกฉบับร่างแล้ว ยังไม่ได้สร้างหน่วยจัดเก็บ",
            )}
          </p>
        )}
        {draft.pending && !review && (
          <Notice
            tone="warning"
            title={tr(
              "Checking the previous save",
              "กำลังตรวจสอบการบันทึกครั้งก่อน",
            )}
            body={tr(
              "Retry the same request to recover the result safely. Do not start a new batch.",
              "ลองคำขอเดิมเพื่อตรวจสอบผลอย่างปลอดภัย อย่าเริ่มชุดใหม่",
            )}
          >
            <Button
              disabled={op.busy}
              onClick={() => void send(draft.pending!.kind)}
            >
              {tr("Retry saved request", "ลองคำขอเดิมอีกครั้ง")}
            </Button>
          </Notice>
        )}
        <fieldset disabled={!editable} className="min-w-0 space-y-5">
          <div className={`${panel} grid gap-4 sm:grid-cols-2 lg:grid-cols-3`}>
            <Field
              label={tr("Batch total quantity", "จำนวนสินค้ารวมของชุดนี้")}
              value={draft.total}
              onChange={(total) => revise({ total })}
              type="number"
              min={0}
              step={quantityPrecision(product.unit) === 0 ? "1" : "0.001"}
              disabled={batch?.status === "CREATED"}
              required
            />
            <label className="space-y-2 text-sm">
              <span>{tr("Packing format", "รูปแบบบรรจุ")}</span>
              <select
                className="h-11 w-full rounded-md border border-input bg-background px-3"
                value={draft.storageFormat}
                onChange={(e) =>
                  persist({
                    ...draft,
                    storageFormat: e.target.value as Format,
                    rows: draft.rows.map((r) => ({ ...r, checked: false })),
                  })
                }
              >
                <option value="PALLET">{tr("Pallet", "พาเลท")}</option>
                <option value="BOX">{tr("Box", "กล่อง")}</option>
                <option value="OTHER">
                  {tr("Other storage unit", "หน่วยจัดเก็บอื่น")}
                </option>
              </select>
            </label>
            <Field
              label={tr("Batch lot (optional)", "ล็อตของชุด (ไม่บังคับ)")}
              value={draft.lot}
              onChange={(lot) => persist({ ...draft, lot })}
            />
            <label className="space-y-2 text-sm">
              <span>{tr("Split method", "วิธีแบ่ง")}</span>
              <select
                className="h-11 w-full rounded-md border border-input bg-background px-3"
                value={draft.mode}
                onChange={(e) => revise({ mode: e.target.value as Mode })}
              >
                <option value="CAPACITY">
                  {tr("By quantity per unit", "ตามจำนวนต่อหน่วย")}
                </option>
                <option value="EQUAL">
                  {tr("Split equally", "แบ่งเท่ากัน")}
                </option>
                <option value="MANUAL">{tr("Manual", "กำหนดเอง")}</option>
              </select>
            </label>
            {draft.mode === "CAPACITY" && (
              <Field
                label={`${tr("Quantity per", "จำนวนต่อ")}${locale === "th" ? "" : " "}${noun}`}
                value={draft.capacity}
                onChange={(capacity) => revise({ capacity })}
                type="number"
                min={0}
                step={quantityPrecision(product.unit) === 0 ? "1" : "0.001"}
              />
            )}
            {draft.mode === "EQUAL" && (
              <Field
                label={tr("Number of units", "จำนวนหน่วย")}
                value={draft.count}
                onChange={(count) => revise({ count })}
                type="number"
                min={1}
                max={50}
                step="1"
              />
            )}
          </div>
          {preview.length > 0 && (
            <p role="status" className="text-sm font-medium">
              {tr("Packing preview", "ผลการแบ่ง")}: {draft.total || "—"}{" "}
              {product.unit} → {preview.length} {plural} ({preview.join(" + ")})
            </p>
          )}
          {draft.splitPending && (
            <Notice
              tone="warning"
              title={tr(
                "Review the new split before replacing your entries.",
                "ตรวจสอบการแบ่งใหม่ก่อนแทนที่รายการที่กรอกไว้",
              )}
              body={tr(
                "Applying this split clears previous measurements. Measure and confirm each new unit again.",
                "การแบ่งนี้จะล้างขนาดเดิม กรุณาวัดและยืนยันขนาดแต่ละหน่วยใหม่",
              )}
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={!preview.length}
                  onClick={applySplit}
                >
                  {tr("Apply this split", "ใช้การแบ่งนี้")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    persist({ ...draft, mode: "MANUAL", splitPending: false })
                  }
                >
                  {tr("Keep current entries", "เก็บรายการปัจจุบัน")}
                </Button>
              </div>
            </Notice>
          )}
          <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <div
                className="flex flex-wrap gap-2"
                aria-label={tr("Select storage unit", "เลือกหน่วยจัดเก็บ")}
              >
                {draft.rows.map((r, i) => (
                  <Button
                    type="button"
                    key={r.id}
                    variant={selected?.id === r.id ? "default" : "outline"}
                    aria-pressed={selected?.id === r.id}
                    onClick={() => persist({ ...draft, selected: r.id })}
                  >
                    {rowName(i)}
                  </Button>
                ))}
              </div>
              <div className={panel}>
                {selected &&
                Number(selected.length) > 0 &&
                Number(selected.width) > 0 &&
                Number(selected.height) > 0 ? (
                  <PalletScene
                    locale={locale}
                    storageFormat={draft.storageFormat}
                    dimensions={{
                      widthMm: mm(selected.width),
                      depthMm: mm(selected.length),
                      heightMm: mm(selected.height),
                    }}
                    label={rowName(draft.rows.indexOf(selected))}
                  />
                ) : (
                  <div className="flex min-h-64 items-center justify-center text-center text-muted">
                    {tr(
                      "Preview only — enter the unit’s actual outer dimensions.",
                      "ภาพตัวอย่าง — กรอกขนาดภายนอกจริงของหน่วยจัดเก็บ",
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="min-w-0 space-y-3">
              {selected ? (
                <section
                  className={`${panel} space-y-4`}
                  aria-label={tr(
                    "Selected storage unit",
                    "หน่วยจัดเก็บที่เลือก",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold">
                      {rowName(draft.rows.indexOf(selected))}
                    </h2>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={tr("Remove unit", "ลบหน่วย")}
                      onClick={() => {
                        const rows = draft.rows.filter(
                          (r) => r.id !== selected.id,
                        );
                        persist({
                          ...draft,
                          rows,
                          selected: rows[0]?.id ?? "",
                          customized: true,
                          mode: "MANUAL",
                          splitPending: false,
                        });
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <Field
                    label={tr("Unit quantity", "จำนวนสินค้าในหน่วยนี้")}
                    value={selected.quantity}
                    onChange={(quantity) =>
                      updateRow(selected.id, { quantity })
                    }
                    type="number"
                    min={0}
                    step={quantityPrecision(product.unit) === 0 ? "1" : "0.001"}
                    required
                  />
                  <p className="text-sm text-muted">
                    {tr(
                      "Measure all outer dimensions including the base and packaging. These measurements are used for storage recommendations.",
                      "วัดขนาดภายนอกทั้งหมด รวมฐานและบรรจุภัณฑ์ ขนาดนี้ใช้แนะนำตำแหน่งจัดเก็บ",
                    )}
                  </p>
                  <div
                    className="flex gap-2"
                    aria-label={tr("Dimension units", "หน่วยขนาด")}
                  >
                    {(["m", "cm"] as const).map((unit) => (
                      <Button
                        key={unit}
                        type="button"
                        variant={
                          draft.displayUnit === unit ? "default" : "outline"
                        }
                        aria-pressed={draft.displayUnit === unit}
                        onClick={() => persist({ ...draft, displayUnit: unit })}
                      >
                        {unit === "m"
                          ? tr("Metres", "เมตร")
                          : tr("Centimetres", "เซนติเมตร")}
                      </Button>
                    ))}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <PackingDimensionFields
                      row={selected}
                      required
                      label={dimensionLabel}
                      displayUnit={draft.displayUnit}
                      onChange={(changes) => updateRow(selected.id, changes)}
                    />
                  </div>
                  <Field
                    label={tr(
                      "Weight (kg, optional)",
                      "น้ำหนัก (กก., ไม่บังคับ)",
                    )}
                    value={selected.weight}
                    onChange={(weight) => updateRow(selected.id, { weight })}
                    type="number"
                    min={0}
                    step="any"
                  />
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-accent"
                      checked={selected.checked}
                      onChange={(e) =>
                        updateRow(selected.id, { checked: e.target.checked })
                      }
                    />
                    {tr(
                      "I checked this unit’s actual outer dimensions, including its base and packaging.",
                      "ตรวจสอบขนาดภายนอกจริงของหน่วยนี้แล้ว รวมฐานและบรรจุภัณฑ์",
                    )}
                  </label>
                  {draft.rows.length > 1 && (
                    <div className="space-y-2">
                      <p className="text-sm">
                        {tr(
                          "Copy dimensions to selected units",
                          "คัดลอกขนาดไปยังหน่วยที่เลือก",
                        )}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {draft.rows.map((r, i) =>
                          r.id === selected.id ? null : (
                            <label
                              key={r.id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={copyTargets.includes(r.id)}
                                onChange={(e) =>
                                  setCopyTargets(
                                    e.target.checked
                                      ? [...copyTargets, r.id]
                                      : copyTargets.filter((id) => id !== r.id),
                                  )
                                }
                              />
                              {rowName(i)}
                            </label>
                          ),
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!copyTargets.some((id) => id !== selected.id)}
                        onClick={() => {
                          persist({
                            ...draft,
                            customized: true,
                            rows: draft.rows.map((r) =>
                              r.id !== selected.id && copyTargets.includes(r.id)
                                ? {
                                    ...r,
                                    length: selected.length,
                                    width: selected.width,
                                    height: selected.height,
                                    weight: selected.weight,
                                    checked: false,
                                  }
                                : r,
                            ),
                          });
                          setCopyTargets([]);
                        }}
                      >
                        <Copy className="size-4" />
                        {tr("Copy selected dimensions", "คัดลอกขนาดที่เลือก")}
                      </Button>
                    </div>
                  )}
                </section>
              ) : (
                <Notice
                  title={tr("No storage units yet", "ยังไม่มีหน่วยจัดเก็บ")}
                />
              )}
              <Button
                type="button"
                variant="outline"
                disabled={draft.rows.length >= MAX_FG_PACKAGES}
                onClick={() => {
                  const row = newRow(
                    remaining !== null && remaining > 0
                      ? String(Number(remaining.toFixed(3)))
                      : "",
                  );
                  persist({
                    ...draft,
                    rows: [...draft.rows, row],
                    selected: row.id,
                    customized: true,
                    mode: "MANUAL",
                    splitPending: false,
                  });
                }}
              >
                <Plus className="size-4" />
                {tr("Add unit", "เพิ่มหน่วย")} ({draft.rows.length}/50)
              </Button>
            </div>
          </div>
          <div
            className="grid gap-3 sm:hidden"
            aria-label={tr("Packing summary cards", "การ์ดสรุปการบรรจุ")}
          >
            {draft.rows.map((r, i) => (
              <button
                key={r.id}
                type="button"
                className={`${panel} space-y-2 text-left ${r.id === selected?.id ? "ring-1 ring-accent" : ""}`}
                onClick={() => persist({ ...draft, selected: r.id })}
              >
                <strong>
                  {rowName(i)} · {r.quantity || "—"} {product.unit}
                </strong>
                <p>
                  {r.length || "—"} × {r.width || "—"} × {r.height || "—"}{" "}
                  {tr("m", "ม.")}
                </p>
                <p className="text-sm text-muted">
                  {r.checked
                    ? tr("Checked", "ตรวจสอบแล้ว")
                    : tr("Needs checking", "รอตรวจสอบ")}
                </p>
              </button>
            ))}
          </div>
          <div className={`${panel} hidden sm:block`}>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                {tr("Packing summary", "สรุปการบรรจุ")}
              </caption>
              <thead>
                <tr>
                  {[
                    tr("Unit", "หน่วย"),
                    tr("Quantity", "จำนวน"),
                    tr("Outer dimensions (m)", "ขนาดภายนอก (ม.)"),
                    tr("Dimensions", "ขนาด"),
                  ].map((label) => (
                    <th
                      key={label}
                      className="pr-3 pb-3 font-medium text-muted"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((r, i) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-3 pr-3">
                      <button
                        type="button"
                        className="text-accent underline"
                        onClick={() => persist({ ...draft, selected: r.id })}
                      >
                        {rowName(i)}
                      </button>
                    </td>
                    <td className="pr-3">{r.quantity || "—"}</td>
                    <td className="pr-3">
                      {r.length || "—"} × {r.width || "—"} × {r.height || "—"}
                    </td>
                    <td>
                      {r.checked
                        ? tr("Checked", "ตรวจสอบแล้ว")
                        : tr("Needs checking", "รอตรวจสอบ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
        <div
          className={`${panel} flex flex-wrap items-center justify-between gap-4`}
        >
          <div aria-live="polite">
            <p>
              {tr("Allocated", "จัดสรรแล้ว")}:{" "}
              <strong>
                {allocatedMinor === null ? "—" : allocatedMinor / 1000} /{" "}
                {draft.total || "—"}
              </strong>{" "}
              {product.unit}
            </p>
            <p
              className={
                remaining !== null && remaining < 0
                  ? "text-danger"
                  : "text-muted"
              }
            >
              {tr("Remaining", "คงเหลือ")}:{" "}
              {remaining === null ? "—" : remaining} {product.unit}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {batch?.status !== "CREATED" && (
              <Button
                type="button"
                variant="outline"
                disabled={!editable}
                onClick={() => void send("save")}
              >
                {op.busy
                  ? tr("Saving…", "กำลังบันทึก…")
                  : tr("Save draft", "บันทึกฉบับร่าง")}
              </Button>
            )}
            <Button
              type="button"
              disabled={!editable || Boolean(issue || draft.splitPending)}
              onClick={() => setReview(true)}
            >
              {batch?.status === "CREATED"
                ? tr("Review repacking", "ตรวจสอบการแบ่งใหม่")
                : tr("Review and create", "ตรวจสอบและสร้าง")}
            </Button>
          </div>
          {issue && !draft.pending && (
            <p className="w-full text-sm text-muted">{issueText}</p>
          )}
        </div>
      </div>
      <Dialog
        open={review}
        onOpenChange={(open) => {
          if (!op.busy) setReview(open);
        }}
      >
        <DialogContent
          closeLabel={tr("Close", "ปิด")}
          showCloseButton={!op.busy}
        >
          <DialogHeader>
            <DialogTitle>
              {batch?.status === "CREATED"
                ? tr("Review batch changes", "ตรวจสอบการแก้ชุดเดิม")
                : tr("Review storage units", "ตรวจสอบหน่วยจัดเก็บ")}
            </DialogTitle>
            <DialogDescription>
              {batch?.status === "CREATED"
                ? tr(
                    "This replaces only this batch’s unreserved units and preserves its total. Previous units remain in history.",
                    "แทนที่เฉพาะหน่วยที่ยังไม่จองของชุดนี้ โดยรักษายอดรวม และเก็บรายการเดิมในประวัติ",
                  )
                : tr(
                    "All units will be created together. Review quantities and actual outer dimensions before confirming.",
                    "สร้างทุกหน่วยพร้อมกัน ตรวจสอบจำนวนและขนาดภายนอกจริงก่อนยืนยัน",
                  )}
            </DialogDescription>
          </DialogHeader>
          <p className="font-semibold">
            {tr("Batch total", "ยอดรวมของชุด")}: {draft.total} {product.unit} ·{" "}
            {draft.rows.length} {plural}
          </p>
          {batch?.status === "CREATED" && (
            <p>
              {tr("Before", "ก่อน")}: {batch.packages.length} {plural} →{" "}
              {tr("After", "หลัง")}: {draft.rows.length} {plural}
            </p>
          )}
          <ol className="space-y-2">
            {draft.rows.map((r, i) => (
              <li key={r.id} className="rounded-lg border border-border p-3">
                {rowName(i)} · {r.quantity} {product.unit}
                <span className="block text-sm text-muted">
                  {r.length} × {r.width} × {r.height} {tr("m", "ม.")}
                </span>
              </li>
            ))}
          </ol>
          <ErrorNotice message={localError || op.error} />
          {draft.pending && (
            <Notice
              tone="warning"
              title={tr(
                "Checking the previous save",
                "กำลังตรวจสอบการบันทึกครั้งก่อน",
              )}
              body={tr(
                "Retry the same request to recover the result safely. Do not start a new batch.",
                "ลองคำขอเดิมเพื่อตรวจสอบผลอย่างปลอดภัย อย่าเริ่มชุดใหม่",
              )}
            />
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={op.busy}
              onClick={() => setReview(false)}
            >
              {tr("Back to edit", "กลับไปแก้ไข")}
            </Button>
            <Button
              disabled={
                op.busy ||
                (!draft.pending &&
                  (!editable || Boolean(issue || draft.splitPending)))
              }
              onClick={() => void send("commit")}
            >
              {op.busy
                ? tr("Saving…", "กำลังบันทึก…")
                : draft.pending
                  ? tr("Retry saved request", "ลองคำขอเดิมอีกครั้ง")
                  : batch?.status === "CREATED"
                    ? tr("Confirm repacking", "ยืนยันแบ่งบรรจุใหม่")
                    : tr(
                        `Confirm create ${draft.rows.length} ${plural}`,
                        `ยืนยันสร้าง ${draft.rows.length} ${plural}`,
                      )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
