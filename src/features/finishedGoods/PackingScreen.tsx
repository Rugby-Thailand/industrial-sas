"use client";
import { resolveWriteError } from "@/lib/resolveWriteError";
import { drafts } from "@/lib/browser/storage";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Copy, PackageCheck } from "lucide-react";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { Panel } from "@/components/ui/Panel";
import { SelectControl } from "@/components/ui/SelectControl";
import { FormSelect } from "@/components/ui/FormSelect";
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
  palletPath,
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
  packedUnit,
  updatePackingRow,
  type PackingRow as Row,
  type PackageDraft,
} from "./packingRows";
import { PackingDimensionFields } from "./PackingDimensionFields";

type Format = "PALLET" | "BOX" | "OTHER";
type Mode = "CAPACITY" | "EQUAL" | "MANUAL";
type Batch = {
  simplePacking?: boolean;
  sameSize?: boolean;
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
  simplePacking?: boolean;
  sameSize?: boolean;
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
  simplePacking: boolean;
  sameSize: boolean;
  groupFill: string;
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
    simplePacking: batch ? (batch.simplePacking ?? false) : true,
    sameSize: batch?.sameSize ?? true,
    groupFill: "100",
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
  return drafts.read(
    key,
    (value) => {
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
        (draft.simplePacking !== undefined &&
          typeof draft.simplePacking !== "boolean") ||
        (draft.sameSize !== undefined && typeof draft.sameSize !== "boolean") ||
        (draft.groupFill !== undefined &&
          typeof draft.groupFill !== "string") ||
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
            typeof row.checked === "boolean" &&
            (row.fillPercent === undefined ||
              typeof row.fillPercent === "string"),
        ) ||
        new Set(draft.rows.map((r) => r.id)).size !== draft.rows.length
      )
        return invalid();
      if (draft.pending) {
        const payload = draft.pending.payload;
        const allowed = new Set([
          "simplePacking",
          "sameSize",
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
          "fillPercent",
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
          (payload.simplePacking !== undefined &&
            typeof payload.simplePacking !== "boolean") ||
          (payload.sameSize !== undefined &&
            typeof payload.sameSize !== "boolean") ||
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
              [
                p.quantity,
                p.lengthMm,
                p.widthMm,
                p.heightMm,
                p.weightKg,
                p.fillPercent,
              ].every(
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
      return {
        ...draft,
        simplePacking: draft.simplePacking ?? false,
        sameSize: draft.sameSize ?? true,
        groupFill: draft.groupFill ?? "100",
      };
    },
    { ...fallback, recoveryBlocked: true },
  );
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
  const { t, tr, locale } = useFGText();
  const writeError = useTranslations("WriteError");
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
      ? t("copy.pallet")
      : draft.storageFormat === "BOX"
        ? t("copy.box")
        : t("copy.storage-unit");
  const plural =
    draft.storageFormat === "PALLET"
      ? t("copy.pallets")
      : draft.storageFormat === "BOX"
        ? t("copy.boxes")
        : t("copy.storage-units");
  const rowName = (i: number) => `${noun} ${i + 1}`;
  const selected =
    draft.rows.find((r) => r.id === draft.selected) ?? draft.rows[0];
  const effectiveRows = draft.rows.map((row) =>
    draft.simplePacking
      ? { ...row, fillPercent: row.fillPercent ?? draft.groupFill }
      : row,
  );
  const packages = effectiveRows.map(packageDraft);
  const issue = validatePacking(
    Number(draft.total),
    effectiveRows.map(packedUnit),
    product.unit,
    draft.simplePacking ? "SIMPLE" : "GEOMETRIC",
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
    `${field === "length" ? t("copy.length") : field === "width" ? t("copy.width") : t("copy.height")} (${draft.displayUnit === "m" ? t("copy.m") : t("copy.cm")})`;
  const issueText = resolveWriteError(issue, writeError, "packing");
  function persist(next: Draft, required = false) {
    const persisted = drafts.write(key, next);
    setStorageWarning(!persisted);
    if (!persisted && required) return false;
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
      simplePacking: draft.simplePacking,
      sameSize: draft.sameSize,
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
      setLocalError(issueText || t("copy.apply-the-new-split-first"));
      return;
    }
    const pending = draft.pending ?? { kind, payload: payload() };
    if (!draft.pending && !persist({ ...draft, pending }, true)) {
      setLocalError(
        t(
          "copy.enable-browser-storage-before-saving-so-retries-cannot-create-duplicates",
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
      if (
        !drafts.write(
          `${scope}:${warehouseId}:batch:${result.batchId}`,
          next,
        ) ||
        !drafts.remove(key)
      )
        setStorageWarning(true);
      router.replace(batchPath(result.batchId));
    }
  }
  if (!canManage)
    return (
      <>
        <Heading title={t("copy.packing-and-dimensions")} />
        <ViewOnlyNotice />
      </>
    );
  if (draft.recoveryBlocked)
    return (
      <>
        <Heading title={t("copy.saved-batch-needs-recovery")} />
        <Notice
          tone="warning"
          title={t("copy.check-existing-batches-before-starting-again")}
        />
        <Button asChild>
          <Link href={productPath(product._id)}>
            {t("copy.review-product-batches")}
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
          title={t("copy.this-batch-has-changed")}
          description={`${product.sku} · ${product.name}`}
        />
        <Notice
          tone="warning"
          title={t("copy.a-newer-packing-revision-is-available")}
          body={t(
            "copy.the-previous-result-is-part-of-history-load-the-latest-batch-before-choo",
          )}
        >
          <Button
            onClick={() => {
              if (batch) persist(initialDraft(product, batch));
              else if (currentBatch) router.push(batchPath(currentBatch._id));
            }}
          >
            {t("copy.load-latest-batch")}
          </Button>
        </Notice>
      </>
    );
  if (draft.completed)
    return (
      <>
        <Heading
          title={t("copy.storage-units-created")}
          description={`${product.sku} · ${product.name}`}
        />
        <div className={`${panel} max-w-3xl space-y-4`}>
          <PackageCheck className="size-8 text-success" />
          <p>
            {draft.total} {product.unit} · {draft.completed.length} {plural}
          </p>
          <p>
            {draft.simplePacking
              ? t(
                  "copy.scan-the-package-labels-in-order-then-scan-their-location",
                )
              : t("copy.choose-an-exact-storage-position-for-each-unit")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {draft.completed.map((id, i) => (
              <Button
                asChild
                variant={
                  !draft.simplePacking && i === 0 ? "default" : "outline"
                }
                key={id}
              >
                <Link
                  href={draft.simplePacking ? palletPath(id) : storagePath(id)}
                >
                  {draft.simplePacking
                    ? t("copy.view-package-label")
                    : t("copy.find-storage-eaab68")}{" "}
                  · {rowName(i)}
                </Link>
              </Button>
            ))}
          </div>
          <Button asChild variant={draft.simplePacking ? "default" : "outline"}>
            <Link
              href={
                draft.simplePacking
                  ? `${FG_PATH}/scan`
                  : productPath(product._id)
              }
            >
              {draft.simplePacking
                ? t("copy.scan-packages")
                : t("copy.product-and-batches")}
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (batch) persist(initialDraft(product, batch));
              else if (draft.batchId) router.push(batchPath(draft.batchId));
            }}
          >
            {t("copy.review-or-edit-this-batch")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const blank = initialDraft(product);
              if (!batch) persist(blank);
              else {
                if (
                  !drafts.write(
                    `${scope}:${warehouseId}:new:${product._id}`,
                    blank,
                  )
                ) {
                  setStorageWarning(true);
                  return;
                }
                router.push(`${productPath(product._id)}/packing`);
              }
            }}
          >
            {t("copy.prepare-another-batch")}
          </Button>
        </div>
      </>
    );
  return (
    <>
      <Heading
        title={
          batch?.status === "CREATED"
            ? t("copy.edit-batch-packing")
            : t("copy.prepare-packages")
        }
        description={`${product.sku} · ${product.name} · ${product.unit}`}
        back={productPath(product._id)}
        backLabel={t("copy.product-details")}
      />
      <div className="space-y-5">
        {!review && <ErrorNotice message={localError || op.error} />}
        {product.status !== "ACTIVE" && (
          <Notice
            tone="warning"
            title={t("copy.activate-this-product-before-preparing-a-batch")}
          />
        )}
        {!batchEditable && (
          <Notice
            tone="warning"
            title={t(
              "copy.this-batch-cannot-be-repacked-while-its-units-are-reserved-moving-or-sto",
            )}
            body={
              blockedReason
                ? t(
                    "copy.finish-the-move-or-release-reservations-first-stored-units-require-a-phy",
                  )
                : ""
            }
          />
        )}
        {stale && (
          <Notice
            tone="warning"
            title={t("copy.this-batch-changed-in-another-session")}
          >
            <Button onClick={() => persist(initialDraft(product, batch))}>
              {t("copy.load-latest-batch")}
            </Button>
          </Notice>
        )}
        {storageWarning && (
          <Notice
            tone="warning"
            title={t("copy.local-recovery-could-not-be-saved")}
          />
        )}
        {saved && (
          <p role="status" className="text-success">
            {t("copy.draft-saved-no-storage-units-have-been-created")}
          </p>
        )}
        {draft.pending && !review && (
          <Notice
            tone="warning"
            title={t("copy.checking-the-previous-save")}
            body={t(
              "copy.retry-the-same-request-to-recover-the-result-safely-do-not-start-a-new-b",
            )}
          >
            <Button
              disabled={op.busy}
              onClick={() => void send(draft.pending!.kind)}
            >
              {t("copy.retry-saved-request")}
            </Button>
          </Notice>
        )}
        <fieldset disabled={!editable} className="min-w-0 space-y-5">
          <Panel className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label={t("copy.batch-total-quantity")}
              value={draft.total}
              onChange={(total) => revise({ total })}
              type="number"
              min={0}
              step={quantityPrecision(product.unit) === 0 ? "1" : "0.001"}
              disabled={batch?.status === "CREATED"}
              required
            />
            <FormSelect
              label={t("copy.packing-format")}
              value={draft.storageFormat}
              onValueChange={(storageFormat) =>
                persist({
                  ...draft,
                  storageFormat: storageFormat as Format,
                  rows: draft.rows.map((r) => ({ ...r, checked: false })),
                })
              }
              options={[
                { value: "PALLET", label: t("copy.pallet-4bb673") },
                { value: "BOX", label: t("copy.box-529a37") },
                {
                  value: "OTHER",
                  label: t("copy.other-storage-unit"),
                },
              ]}
              placeholder={t("copy.pallet-4bb673")}
              emptyLabel={t("copy.no-packing-formats-available")}
            />
            <Field
              label={t("copy.batch-lot-optional")}
              value={draft.lot}
              onChange={(lot) => persist({ ...draft, lot })}
            />
            <div className="space-y-2 text-sm">
              <span>{t("copy.split-method")}</span>
              <SelectControl
                label={t("copy.split-method")}
                value={draft.mode}
                onValueChange={(mode) => revise({ mode: mode as Mode })}
                options={[
                  {
                    value: "CAPACITY",
                    label: t("copy.by-quantity-per-unit"),
                  },
                  { value: "EQUAL", label: t("copy.split-equally") },
                  { value: "MANUAL", label: t("copy.manual") },
                ]}
                placeholder={t("copy.by-quantity-per-unit")}
                emptyLabel={t("copy.no-split-methods-available")}
              />
            </div>
            {draft.mode === "CAPACITY" && (
              <Field
                label={`${t("copy.quantity-per")}${locale === "th" ? "" : " "}${noun}`}
                value={draft.capacity}
                onChange={(capacity) => revise({ capacity })}
                type="number"
                min={0}
                step={quantityPrecision(product.unit) === 0 ? "1" : "0.001"}
              />
            )}
            {draft.mode === "EQUAL" && (
              <Field
                label={t("copy.number-of-units")}
                value={draft.count}
                onChange={(count) => revise({ count })}
                type="number"
                min={1}
                max={50}
                step="1"
              />
            )}
          </Panel>
          {preview.length > 0 && (
            <p role="status" className="text-sm font-medium">
              {t("copy.packing-preview")}: {draft.total || "—"} {product.unit} →{" "}
              {preview.length} {plural} ({preview.join(" + ")})
            </p>
          )}
          {draft.splitPending && (
            <Notice
              tone="warning"
              title={t(
                "copy.review-the-new-split-before-replacing-your-entries",
              )}
              body={t(
                "copy.applying-this-split-clears-previous-measurements-measure-and-confirm-eac",
              )}
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={!preview.length}
                  onClick={applySplit}
                >
                  {t("copy.apply-this-split")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    persist({ ...draft, mode: "MANUAL", splitPending: false })
                  }
                >
                  {t("copy.keep-current-entries")}
                </Button>
              </div>
            </Notice>
          )}
          <div className={`${panel} space-y-4`}>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={t("copy.preparation-mode")}
            >
              <Button
                type="button"
                variant={draft.simplePacking ? "default" : "outline"}
                aria-pressed={draft.simplePacking}
                onClick={() => persist({ ...draft, simplePacking: true })}
              >
                {t("copy.simple-packing")}
              </Button>
              <Button
                type="button"
                variant={!draft.simplePacking ? "default" : "outline"}
                aria-pressed={!draft.simplePacking}
                onClick={() => persist({ ...draft, simplePacking: false })}
              >
                {t("copy.exact-measurements-optional")}
              </Button>
            </div>
            {draft.simplePacking && (
              <>
                <p className="font-medium">
                  {t("copy.are-all-packages-pallets-a-similar-size")}
                </p>
                <div className="flex gap-2">
                  {[true, false].map((sameSize) => (
                    <Button
                      type="button"
                      key={String(sameSize)}
                      variant={
                        draft.sameSize === sameSize ? "default" : "outline"
                      }
                      aria-pressed={draft.sameSize === sameSize}
                      onClick={() => persist({ ...draft, sameSize })}
                    >
                      {sameSize ? t("copy.yes") : t("copy.no")}
                    </Button>
                  ))}
                </div>
                <p className="font-medium">{t("copy.how-full-are-they")}</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["100", t("copy.full-100")],
                    ["75", "¾ (75%)"],
                    ["50", t("copy.half-50")],
                    ["25", "¼ (25%)"],
                  ].map(([value, label]) => (
                    <Button
                      type="button"
                      key={value}
                      variant={
                        draft.groupFill === value &&
                        draft.rows.every(
                          (r) => !r.fillPercent || r.fillPercent === value,
                        )
                          ? "default"
                          : "outline"
                      }
                      onClick={() =>
                        persist({
                          ...draft,
                          groupFill: value!,
                          rows: draft.rows.map((r) => ({
                            ...r,
                            fillPercent: value!,
                          })),
                        })
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <Field
                  label={t("copy.custom-fullness-for-all")}
                  value={draft.groupFill}
                  type="number"
                  min={1}
                  max={100}
                  step="1"
                  onChange={(groupFill) =>
                    persist({
                      ...draft,
                      groupFill,
                      rows: draft.rows.map((r) => ({
                        ...r,
                        fillPercent: groupFill,
                      })),
                    })
                  }
                />
                <p className="text-sm text-muted">
                  {t(
                    "copy.apply-one-answer-to-all-units-adjust-only-exceptions-below-no-measuremen",
                  )}
                </p>
              </>
            )}
          </div>
          {draft.simplePacking ? (
            <div className="space-y-3">
              {effectiveRows.map((row, index) => (
                <section
                  key={row.id}
                  className={`${panel} space-y-3`}
                  aria-label={rowName(index)}
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg leading-7 font-semibold">
                      {rowName(index)}
                    </h2>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${t("copy.remove")} ${rowName(index)}`}
                      onClick={() =>
                        persist({
                          ...draft,
                          rows: draft.rows.filter((r) => r.id !== row.id),
                          mode: "MANUAL",
                          customized: true,
                          splitPending: false,
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label={`${t("copy.quantity")} · ${rowName(index)}`}
                      type="number"
                      min={0}
                      step={
                        quantityPrecision(product.unit) === 0 ? "1" : "0.001"
                      }
                      required
                      value={row.quantity}
                      onChange={(quantity) => updateRow(row.id, { quantity })}
                    />
                    <Field
                      label={`${t("copy.fullness")} · ${rowName(index)}`}
                      type="number"
                      min={1}
                      max={100}
                      step="1"
                      required
                      value={row.fillPercent ?? draft.groupFill}
                      onChange={(fillPercent) =>
                        updateRow(row.id, { fillPercent })
                      }
                    />
                  </div>
                </section>
              ))}
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
                {t("copy.add-unit")} ({draft.rows.length}/50)
              </Button>
            </div>
          ) : (
            <>
              <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
                <div className="min-w-0 space-y-3">
                  <div
                    className="flex flex-wrap gap-2"
                    aria-label={t("copy.select-storage-unit")}
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
                        {t(
                          "copy.preview-only-enter-the-unit-s-actual-outer-dimensions",
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="min-w-0 space-y-3">
                  {selected ? (
                    <section
                      className={`${panel} space-y-4`}
                      aria-label={t("copy.selected-storage-unit")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-lg leading-7 font-semibold">
                          {rowName(draft.rows.indexOf(selected))}
                        </h2>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("copy.remove-unit")}
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
                        label={t("copy.unit-quantity")}
                        value={selected.quantity}
                        onChange={(quantity) =>
                          updateRow(selected.id, { quantity })
                        }
                        type="number"
                        min={0}
                        step={
                          quantityPrecision(product.unit) === 0 ? "1" : "0.001"
                        }
                        required
                      />
                      <p className="text-sm text-muted">
                        {t(
                          "copy.measure-all-outer-dimensions-including-the-base-and-packaging-these-meas",
                        )}
                      </p>
                      <div
                        className="flex gap-2"
                        aria-label={t("copy.dimension-units")}
                      >
                        {(["m", "cm"] as const).map((unit) => (
                          <Button
                            key={unit}
                            type="button"
                            variant={
                              draft.displayUnit === unit ? "default" : "outline"
                            }
                            aria-pressed={draft.displayUnit === unit}
                            onClick={() =>
                              persist({ ...draft, displayUnit: unit })
                            }
                          >
                            {unit === "m"
                              ? t("copy.metres")
                              : t("copy.centimetres")}
                          </Button>
                        ))}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <PackingDimensionFields
                          row={selected}
                          required
                          label={dimensionLabel}
                          displayUnit={draft.displayUnit}
                          onChange={(changes) =>
                            updateRow(selected.id, changes)
                          }
                        />
                      </div>
                      <Field
                        label={t("copy.weight-kg-optional")}
                        value={selected.weight}
                        onChange={(weight) =>
                          updateRow(selected.id, { weight })
                        }
                        type="number"
                        min={0}
                        step="any"
                      />
                      <label className="flex items-start gap-3 text-sm">
                        <CheckboxControl
                          className="mt-1 size-4 shrink-0 accent-accent"
                          checked={selected.checked}
                          onChange={(e) =>
                            updateRow(selected.id, {
                              checked: e.target.checked,
                            })
                          }
                        />
                        {t(
                          "copy.i-checked-this-unit-s-actual-outer-dimensions-including-its-base-and-pac",
                        )}
                      </label>
                      {draft.rows.length > 1 && (
                        <div className="space-y-2">
                          <p className="text-sm">
                            {t("copy.copy-dimensions-to-selected-units")}
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
                                          : copyTargets.filter(
                                              (id) => id !== r.id,
                                            ),
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
                            disabled={
                              !copyTargets.some((id) => id !== selected.id)
                            }
                            onClick={() => {
                              persist({
                                ...draft,
                                customized: true,
                                rows: draft.rows.map((r) =>
                                  r.id !== selected.id &&
                                  copyTargets.includes(r.id)
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
                            {t("copy.copy-selected-dimensions")}
                          </Button>
                        </div>
                      )}
                    </section>
                  ) : (
                    <Notice title={t("copy.no-storage-units-yet")} />
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
                    {t("copy.add-unit")} ({draft.rows.length}/50)
                  </Button>
                </div>
              </div>
              <div
                className="grid gap-3 sm:hidden"
                aria-label={t("copy.packing-summary-cards")}
              >
                {draft.rows.map((r, i) => (
                  <Button
                    key={r.id}
                    type="button"
                    variant="ghost"
                    className={`${panel} space-y-2 text-left ${r.id === selected?.id ? "ring-1 ring-accent" : ""}`}
                    onClick={() => persist({ ...draft, selected: r.id })}
                  >
                    <strong>
                      {rowName(i)} · {r.quantity || "—"} {product.unit}
                    </strong>
                    <p>
                      {r.length || "—"} × {r.width || "—"} × {r.height || "—"}{" "}
                      {t("copy.m")}
                    </p>
                    <p className="text-sm text-muted">
                      {r.checked ? t("copy.checked") : t("copy.needs-checking")}
                    </p>
                  </Button>
                ))}
              </div>
              <div className={`${panel} hidden sm:block`}>
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">
                    {t("copy.packing-summary")}
                  </caption>
                  <thead>
                    <tr>
                      {[
                        t("copy.unit"),
                        t("copy.quantity"),
                        t("copy.outer-dimensions-m"),
                        t("copy.dimensions"),
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
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="text-link underline"
                            onClick={() =>
                              persist({ ...draft, selected: r.id })
                            }
                          >
                            {rowName(i)}
                          </Button>
                        </td>
                        <td className="pr-3">{r.quantity || "—"}</td>
                        <td className="pr-3">
                          {r.length || "—"} × {r.width || "—"} ×{" "}
                          {r.height || "—"}
                        </td>
                        <td>
                          {r.checked
                            ? t("copy.checked")
                            : t("copy.needs-checking")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </fieldset>
        <StickyActionBar className="flex flex-wrap items-center justify-between gap-4">
          <div aria-live="polite">
            <p>
              {t("copy.allocated")}:{" "}
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
              {t("copy.remaining")}: {remaining === null ? "—" : remaining}{" "}
              {product.unit}
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
                {op.busy ? t("copy.saving") : t("copy.save-draft")}
              </Button>
            )}
            <Button
              type="button"
              disabled={!editable || Boolean(issue || draft.splitPending)}
              onClick={() => setReview(true)}
            >
              {batch?.status === "CREATED"
                ? t("copy.review-repacking")
                : t("copy.review-and-create")}
            </Button>
          </div>
          {issue && !draft.pending && (
            <p className="w-full text-sm text-muted">{issueText}</p>
          )}
        </StickyActionBar>
      </div>
      <Dialog
        open={review}
        onOpenChange={(open) => {
          if (!op.busy) setReview(open);
        }}
      >
        <DialogContent closeLabel={t("copy.close")} showCloseButton={!op.busy}>
          <DialogHeader>
            <DialogTitle>
              {batch?.status === "CREATED"
                ? t("copy.review-batch-changes")
                : t("copy.review-storage-units")}
            </DialogTitle>
            <DialogDescription>
              {batch?.status === "CREATED"
                ? t(
                    "copy.this-replaces-only-this-batch-s-unreserved-units-and-preserves-its-total",
                  )
                : t(
                    "copy.all-units-will-be-created-together-review-the-package-details-before-con",
                  )}
            </DialogDescription>
          </DialogHeader>
          <p className="font-semibold">
            {t("copy.batch-total-7885f8")}: {draft.total} {product.unit} ·{" "}
            {draft.rows.length} {plural}
          </p>
          {batch?.status === "CREATED" && (
            <p>
              {t("copy.before")}: {batch.packages.length} {plural} →{" "}
              {t("copy.after")}: {draft.rows.length} {plural}
            </p>
          )}
          <ol className="space-y-2">
            {draft.rows.map((r, i) => (
              <li key={r.id} className="rounded-lg border border-border p-3">
                {rowName(i)} · {r.quantity} {product.unit}
                <span className="block text-sm text-muted">
                  {draft.simplePacking
                    ? `${r.fillPercent ?? draft.groupFill}% ${t("copy.full")}`
                    : `${r.length} × ${r.width} × ${r.height} ${t("copy.m")}`}
                </span>
              </li>
            ))}
          </ol>
          <ErrorNotice message={localError || op.error} />
          {draft.pending && (
            <Notice
              tone="warning"
              title={t("copy.checking-the-previous-save")}
              body={t(
                "copy.retry-the-same-request-to-recover-the-result-safely-do-not-start-a-new-b",
              )}
            />
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={op.busy}
              onClick={() => setReview(false)}
            >
              {t("copy.back-to-edit")}
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
                ? t("copy.saving")
                : draft.pending
                  ? t("copy.retry-saved-request")
                  : batch?.status === "CREATED"
                    ? t("copy.confirm-repacking-6945d2")
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
