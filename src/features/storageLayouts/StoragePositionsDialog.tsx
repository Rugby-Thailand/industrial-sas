"use client";

import { useMutation } from "convex/react";
import { Archive, PencilLine, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useState, type FormEvent } from "react";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import { useWorkflowStep } from "@/hooks/useWorkflowStep";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/Notice";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import {
  storageLayoutRefs,
  type StoragePositionRow,
  type StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";
import { generateRackPositions } from "../../../convex/model/storageLayout/storagePosition";
import {
  layoutFailure,
  MeasureInput,
  OperationFailure,
  storageWriteMessage,
} from "./layoutActions";
import { measuredMillimetres, whenGuardIdle } from "./measure";
import { metres } from "./storageLayoutShared";

type Geometry = { x: string; y: string; width: string; depth: string };
const geometryOf = (position: StoragePositionRow): Geometry => ({
  x: position.xMm === undefined ? "" : String(metres(position.xMm)),
  y: position.yMm === undefined ? "" : String(metres(position.yMm)),
  width: position.widthMm === undefined ? "" : String(metres(position.widthMm)),
  depth: position.depthMm === undefined ? "" : String(metres(position.depthMm)),
});
const geometryMm = (geometry: Geometry) => {
  const value = {
    xMm: measuredMillimetres(geometry.x),
    yMm: measuredMillimetres(geometry.y),
    widthMm: measuredMillimetres(geometry.width),
    depthMm: measuredMillimetres(geometry.depth),
  };
  return Object.values(value).every((part) => part !== null)
    ? (value as Record<keyof typeof value, number>)
    : null;
};

/**
 * Exact positions inside one storage spot (F16): list with QR, add/edit/archive
 * for floor grids and platforms, and previewed rack generation for racks. Every
 * write uses the existing position APIs; ordinary edits keep code and QR.
 */
export function StoragePositionsDialog({
  warehouseId,
  zone,
  onClose,
}: {
  readonly warehouseId: string;
  /** The managed spot; undefined keeps the shared Dialog mounted but closed. */
  readonly zone: StorageZoneRow | undefined;
  readonly onClose: () => void;
}) {
  const t = useTranslations("StorageLayouts");
  // Mounted while closed, so opening and closing always own one foreground
  // entry through the shared Dialog (never an unmounted, unconsumed entry).
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={zone !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      backPending={busy}
    >
      {zone === undefined ? null : (
        <DialogContent closeLabel={t("closeDialog")} className="max-w-4xl">
          <PositionsManager
            key={zone.zoneId}
            warehouseId={warehouseId}
            zone={zone}
            onBusyChange={setBusy}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function PositionsManager({
  warehouseId,
  zone,
  onBusyChange,
}: {
  readonly warehouseId: string;
  readonly zone: StorageZoneRow;
  readonly onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const exact = zone.positions.filter((position) => !position.isDefault);
  const occupied =
    zone.placements.length + (zone.unmeasuredPalletCount ?? 0) > 0;
  const operation = useAsyncOperation({
    scope: `storage-positions:${warehouseId}:${zone.zoneId}`,
    describeError: (code) => code || "NETWORK_ERROR",
    navigation: "write",
  });
  const [message, setMessage] = useState<string>();
  const [refusal, setRefusal] = useState<string>();
  const [editing, setEditing] = useState<StoragePositionRow>();
  // Editing one position is an earlier step inside the manager: Back and
  // Cancel return to the list with any add/generate draft retained.
  const editScope = `storage-position-edit:${zone.zoneId}`;
  const editStep = useWorkflowStep(
    "positionEdit",
    editScope,
    true,
    () => setEditing(undefined),
    { priority: 110, blocked: operation.busy },
  );
  const [editSaved, setEditSaved] = useState(false);
  // Close the edit step only once the successful write has settled.
  useEffect(() => {
    if (!editSaved || operation.busy || !editStep.active) return;
    whenGuardIdle(() => editStep.back());
  });
  useLayoutEffect(() => {
    onBusyChange(operation.busy);
  }, [operation.busy, onBusyChange]);
  const [archiving, setArchiving] = useState<StoragePositionRow>();
  const create = useMutation(storageLayoutRefs.createPosition);
  const update = useMutation(storageLayoutRefs.updatePosition);
  const archive = useMutation(storageLayoutRefs.archivePosition);
  const generate = useMutation(storageLayoutRefs.generateRackPositions);

  /** Run one position write with shared refusal and success reporting. */
  async function write<T extends { ok: boolean }>(
    send: () => Promise<T>,
    success: string,
    after?: () => void,
  ): Promise<boolean> {
    setRefusal(undefined);
    setMessage(undefined);
    let saved = false;
    await operation.run(send, (outcome) => {
      const result = outcome as unknown as
        | { ok: false; denial: { code: string } }
        | {
            ok: true;
            value:
              | { written: true; createdCount?: number }
              | { written: false; error: { code: string } };
          };
      if (!result.ok) setRefusal(result.denial.code);
      else if (!result.value.written) setRefusal(result.value.error.code);
      else {
        operation.clearRequests();
        setMessage(success);
        saved = true;
        after?.();
      }
    });
    return saved;
  }

  const failure = layoutFailure(refusal, operation);
  const editingActive = editing !== undefined && editStep.active;
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("layoutActions.positions.manageTitle", { code: zone.code })}
        </DialogTitle>
        <DialogDescription>
          {t("layoutActions.positions.description")}
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-[calc(100dvh-14rem)] space-y-4 overflow-y-auto">
        <p className="text-xs text-muted">
          {t("layoutActions.positions.withinSpot", {
            x: metres(zone.xMm),
            right: metres(zone.xMm + zone.widthMm),
            y: metres(zone.yMm),
            bottom: metres(zone.yMm + zone.depthMm),
          })}
        </p>
        {occupied ? (
          <Notice tone="muted" title={t("layoutActions.positions.occupied")} />
        ) : null}
        {exact.length === 0 ? (
          <Notice tone="warning" title={t("layoutActions.positions.none")} />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {exact.map((position) => (
              <li
                key={position.locationId}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold break-all">
                    {position.code}
                  </p>
                  <p className="text-sm">{position.label}</p>
                  <p className="text-xs text-muted tabular-nums">
                    X {position.xMm === undefined ? "—" : metres(position.xMm)}{" "}
                    · Y{" "}
                    {position.yMm === undefined ? "—" : metres(position.yMm)} ·{" "}
                    {position.widthMm === undefined
                      ? "—"
                      : metres(position.widthMm)}{" "}
                    ×{" "}
                    {position.depthMm === undefined
                      ? "—"
                      : metres(position.depthMm)}{" "}
                    m
                    {position.elevationMm === undefined
                      ? ""
                      : ` · ${t("elevationValue", { value: metres(position.elevationMm) })}`}
                  </p>
                  <code className="text-xs break-all text-muted">
                    {t("layoutActions.qr.exact")}: {position.qrValue}
                  </code>
                </div>
                {position.positionId === undefined ? null : (
                  <div className="flex gap-1">
                    {position.kind === "RACK_SLOT" ? null : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={operation.busy}
                        onClick={() => {
                          setEditSaved(false);
                          setEditing(position);
                          editStep.enter();
                        }}
                        aria-label={t("layoutActions.positions.edit", {
                          code: position.code,
                        })}
                      >
                        <PencilLine aria-hidden="true" className="size-4" />
                        {t("edit")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={operation.busy || occupied}
                      onClick={() => {
                        setRefusal(undefined);
                        setArchiving(position);
                      }}
                      aria-label={t("layoutActions.positions.archive", {
                        code: position.code,
                      })}
                    >
                      <Archive aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {editingActive && editing?.positionId !== undefined ? (
          <PositionForm
            key={editing.positionId}
            zone={zone}
            initial={{
              code: editing.code,
              label: editing.label,
              ...geometryOf(editing),
            }}
            codeLocked
            clean={editSaved}
            geometryLocked={occupied}
            busy={operation.busy}
            submitLabel={t("savePosition")}
            onCancel={() => editStep.back()}
            onSubmit={(value) => {
              const payload = {
                warehouseId,
                positionId: editing.positionId!,
                label: value.label,
                ...value.geometry,
                ...(editing.revision === undefined
                  ? {}
                  : { expectedRevision: editing.revision }),
              };
              return write(
                () =>
                  update({
                    ...payload,
                    requestId: operation.request(JSON.stringify(payload)),
                  }),
                t("layoutActions.positions.saved"),
                () => setEditSaved(true),
              );
            }}
          />
        ) : null}
        {/* Kept mounted while one position is edited, so its draft returns. */}
        <div hidden={editingActive}>
          {zone.mode === "RACK" ? (
            <RackGenerator
              zone={zone}
              draftScope={editScope}
              disabled={occupied}
              busy={operation.busy}
              onGenerate={(config) => {
                const payload = { warehouseId, zoneId: zone.zoneId, ...config };
                return write(
                  () =>
                    generate({
                      ...payload,
                      requestId: operation.request(JSON.stringify(payload)),
                    }),
                  t("layoutActions.rack.generated", { count: config.count }),
                );
              }}
            />
          ) : zone.mode === "FLOOR_POSITIONS" || zone.mode === "PLATFORM" ? (
            occupied ? null : (
              <PositionForm
                zone={zone}
                draftScope={editScope}
                initial={{
                  code: "",
                  label: "",
                  x: String(metres(zone.xMm)),
                  y: String(metres(zone.yMm)),
                  width: "",
                  depth: "",
                }}
                busy={operation.busy}
                submitLabel={t("layoutActions.positions.add")}
                onSubmit={(value) => {
                  const payload = {
                    warehouseId,
                    zoneId: zone.zoneId,
                    code: value.code,
                    label: value.label || value.code,
                    ...value.geometry,
                  };
                  return write(
                    () =>
                      create({
                        ...payload,
                        requestId: operation.request(JSON.stringify(payload)),
                      }),
                    t("layoutActions.positions.added", {
                      code: `${zone.code}-${value.code.trim().toUpperCase()}`,
                    }),
                  );
                }}
              />
            )
          ) : null}
        </div>
        {message ? (
          <p role="status" className="text-sm text-success">
            {message}
          </p>
        ) : null}
        <OperationFailure failure={failure} />
      </div>
      <ConfirmDialog
        open={archiving !== undefined}
        onOpenChange={(open) => {
          if (!open) setArchiving(undefined);
        }}
        title={t("layoutActions.positions.archive", {
          code: archiving?.code ?? "",
        })}
        description={t("layoutActions.archiveZoneDescription", { count: 0 })}
        cancelLabel={t("cancel")}
        confirmLabel={t("archiveZone")}
        pendingLabel={t("layoutActions.archivingZone")}
        tone="destructive"
        pending={operation.busy}
        onConfirm={() => {
          const target = archiving;
          if (target?.positionId === undefined) return;
          const payload = { warehouseId, positionId: target.positionId };
          void write(
            () =>
              archive({
                ...payload,
                requestId: operation.request(JSON.stringify(payload)),
              }),
            t("layoutActions.positions.archived"),
            () => operation.complete(() => setArchiving(undefined)),
          );
        }}
        error={
          failure === undefined
            ? undefined
            : failure.thrown
              ? t("layoutActions.failure.network")
              : storageWriteMessage(t, failure.code)
        }
      />
    </>
  );
}

function PositionForm({
  zone,
  initial,
  draftScope,
  clean = false,
  codeLocked = false,
  geometryLocked = false,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly zone: StorageZoneRow;
  readonly initial: Geometry & { code: string; label: string };
  /** Retained by this earlier step's Back (the add form under an edit). */
  readonly draftScope?: string;
  /** The write succeeded; nothing is left to protect. */
  readonly clean?: boolean;
  readonly codeLocked?: boolean;
  readonly geometryLocked?: boolean;
  readonly busy: boolean;
  readonly submitLabel: string;
  readonly onSubmit: (value: {
    code: string;
    label: string;
    geometry: { xMm: number; yMm: number; widthMm: number; depthMm: number };
  }) => Promise<boolean>;
  readonly onCancel?: () => void;
}) {
  const t = useTranslations("StorageLayouts");
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  useNavigationDraft({
    dirty: !clean && JSON.stringify(draft) !== JSON.stringify(baseline),
    pending: busy,
    discard: () => setBaseline(draft),
    ...(draftScope === undefined ? {} : { workflowScope: draftScope }),
  });
  const geometry = geometryMm(draft);
  const inside =
    geometry !== null &&
    geometry.widthMm > 0 &&
    geometry.depthMm > 0 &&
    geometry.xMm >= zone.xMm &&
    geometry.yMm >= zone.yMm &&
    geometry.xMm + geometry.widthMm <= zone.xMm + zone.widthMm &&
    geometry.yMm + geometry.depthMm <= zone.yMm + zone.depthMm;
  const code = draft.code.trim().toUpperCase();
  const valid =
    inside && (codeLocked || /^[A-Z0-9][A-Z0-9-]{0,47}$/.test(code));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!valid || geometry === null || busy) return;
    void onSubmit({ code, label: draft.label.trim(), geometry }).then(
      (saved) => {
        if (!saved) return;
        if (codeLocked) setBaseline(draft);
        else {
          const next = { ...draft, code: "", label: "" };
          setDraft(next);
          setBaseline(next);
        }
      },
    );
  };
  const field = (key: keyof Geometry, label: string) => (
    <div key={key}>
      <Label htmlFor={`position-${key}`}>{label}</Label>
      <MeasureInput
        id={`position-${key}`}
        className="mt-2"
        min={key === "x" || key === "y" ? 0 : 0.001}
        value={draft[key]}
        disabled={geometryLocked}
        onChange={(event) =>
          setDraft((current) => ({ ...current, [key]: event.target.value }))
        }
      />
    </div>
  );
  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
      aria-label={submitLabel}
    >
      <div>
        <Label htmlFor="position-code">{t("positionCode")}</Label>
        <Input
          id="position-code"
          className="mt-2"
          value={draft.code}
          disabled={codeLocked}
          onChange={(event) =>
            setDraft((current) => ({ ...current, code: event.target.value }))
          }
        />
        {codeLocked ? null : (
          <p className="mt-1 text-xs text-muted">
            {t("layoutActions.positions.codePreview", {
              code: `${zone.code}-${code || "…"}`,
            })}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="position-label">{t("positionLabel")}</Label>
        <Input
          id="position-label"
          className="mt-2"
          value={draft.label}
          onChange={(event) =>
            setDraft((current) => ({ ...current, label: event.target.value }))
          }
        />
      </div>
      {field("x", t("x"))}
      {field("y", t("y"))}
      {field("width", t("zoneWidth"))}
      {field("depth", t("zoneDepth"))}
      {geometry !== null && !inside ? (
        <p className="text-xs text-warning sm:col-span-2" role="status">
          {t("layoutActions.error.POSITION_OUT_OF_AREA")}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={!valid || busy}>
          <Plus aria-hidden="true" className="size-4" />
          {busy ? t("layoutActions.positions.adding") : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function RackGenerator({
  zone,
  draftScope,
  disabled,
  busy,
  onGenerate,
}: {
  readonly zone: StorageZoneRow;
  readonly draftScope: string;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onGenerate: (config: {
    fixtureCode: string;
    bayCount: number;
    levelCount: number;
    slotsPerBay: number;
    bayWidthMm: number;
    rackDepthMm: number;
    levelHeightMm: number;
    count: number;
  }) => Promise<boolean>;
}) {
  const t = useTranslations("StorageLayouts");
  const empty = {
    fixtureCode: "",
    bays: "",
    levels: "",
    slots: "1",
    bayWidth: "",
    rackDepth: "",
    levelHeight: "",
  };
  const [draft, setDraft] = useState(empty);
  const [generated, setGenerated] = useState<string>();
  useNavigationDraft({
    dirty:
      JSON.stringify(draft) !== JSON.stringify(empty) &&
      JSON.stringify(draft) !== generated,
    pending: busy,
    discard: () => setGenerated(JSON.stringify(draft)),
    workflowScope: draftScope,
  });
  const integer = (value: string) =>
    /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
  const config = {
    fixtureCode: draft.fixtureCode.trim().toUpperCase(),
    bayCount: integer(draft.bays),
    levelCount: integer(draft.levels),
    slotsPerBay: integer(draft.slots),
    bayWidthMm: measuredMillimetres(draft.bayWidth) ?? Number.NaN,
    rackDepthMm: measuredMillimetres(draft.rackDepth) ?? Number.NaN,
    levelHeightMm: measuredMillimetres(draft.levelHeight) ?? Number.NaN,
  };
  const complete =
    config.fixtureCode !== "" &&
    Object.values(config).every((value) => !Number.isNaN(value));
  // The same pure generator the server runs, so the preview is exact.
  const preview = complete
    ? generateRackPositions({
        area: {
          xMm: zone.xMm,
          yMm: zone.yMm,
          widthMm: zone.widthMm,
          depthMm: zone.depthMm,
          maxStackHeightMm: zone.maxStackHeightMm,
        },
        ...config,
      })
    : null;
  const positions = preview?.ok ? preview.value : [];
  const levels = [
    ...new Set(positions.map((position) => metres(position.elevationMm))),
  ];
  const text = (key: keyof typeof draft, label: string, measure: boolean) => (
    <div key={key}>
      <Label htmlFor={`rack-${key}`}>{label}</Label>
      {measure ? (
        <MeasureInput
          id={`rack-${key}`}
          className="mt-2"
          min={0.001}
          value={draft[key]}
          disabled={disabled}
          onChange={(event) =>
            setDraft((current) => ({ ...current, [key]: event.target.value }))
          }
        />
      ) : (
        <Input
          id={`rack-${key}`}
          className="mt-2"
          inputMode={key === "fixtureCode" ? "text" : "numeric"}
          value={draft[key]}
          disabled={disabled}
          onChange={(event) =>
            setDraft((current) => ({ ...current, [key]: event.target.value }))
          }
        />
      )}
    </div>
  );
  return (
    <form
      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3"
      aria-label={t("generateRackTitle")}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!preview?.ok || busy || disabled) return;
        void onGenerate({ ...config, count: positions.length }).then(
          (saved) => {
            if (saved) setGenerated(JSON.stringify(draft));
          },
        );
      }}
    >
      <p className="text-sm text-muted sm:col-span-3">
        {t("layoutActions.positions.rackMode")} {t("generateRackHelp")}
      </p>
      {text("fixtureCode", t("fixtureCode"), false)}
      {text("bays", t("bayCount"), false)}
      {text("levels", t("levelCount"), false)}
      {text("slots", t("slotsPerBay"), false)}
      {text("bayWidth", t("bayWidth"), true)}
      {text("rackDepth", t("rackDepth"), true)}
      {text("levelHeight", t("levelHeight"), true)}
      <div
        className="sm:col-span-3"
        aria-live="polite"
        data-testid="rack-preview"
      >
        {preview === null ? null : preview.ok ? (
          <>
            <p className="text-sm font-medium">
              {t("layoutActions.rack.preview", {
                count: positions.length,
                first: `${zone.code}-${positions[0]!.codeSuffix}`,
                last: `${zone.code}-${positions.at(-1)!.codeSuffix}`,
              })}
            </p>
            <p className="text-xs text-muted">
              {t("layoutActions.rack.levels", { levels: levels.join(", ") })}
            </p>
          </>
        ) : (
          <p className="text-sm text-warning">
            {t("layoutActions.rack.invalid", {
              reason:
                preview.error.code === "RACK_DOES_NOT_FIT_AREA"
                  ? t("layoutActions.rack.reason.RACK_DOES_NOT_FIT_AREA")
                  : t("layoutActions.rack.reason.RACK_CONFIGURATION_INVALID", {
                      field:
                        "field" in preview.error ? preview.error.field : "",
                    }),
            })}
          </p>
        )}
      </div>
      <div className="sm:col-span-3">
        <Button type="submit" disabled={!preview?.ok || busy || disabled}>
          {busy
            ? t("layoutActions.rack.generating")
            : t("layoutActions.rack.generate", { count: positions.length })}
        </Button>
      </div>
    </form>
  );
}
