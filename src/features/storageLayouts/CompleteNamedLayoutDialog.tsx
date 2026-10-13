"use client";

import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogCompletionHandle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/Notice";
import { SelectControl } from "@/components/ui/SelectControl";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import {
  storageLayoutRefs,
  type StorageBuildingDetail,
} from "@/lib/convex/storageLayoutApi";
import { layoutFailure, MeasureInput, OperationFailure } from "./layoutActions";
import { measuredMillimetres } from "./measure";
import { metres } from "./storageLayoutShared";
import { findFreePlacement, placementProblem } from "./zonePlacement";

export interface NamedLocationTarget {
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
  readonly buildingId: string;
  readonly floorNumber?: number | undefined;
}

/**
 * Complete layout for a location registered with "layout later" (F20). The
 * existing location keeps its id, code and QR; the manager supplies measured
 * geometry and the server validates fit, overlap and the registration version.
 */
export function CompleteNamedLayoutDialog({
  warehouseId,
  location,
  onClose,
  onReopen,
  onCompleted,
}: {
  readonly warehouseId: string;
  /** Native Forward back onto the dialog's entry restores the registration. */
  readonly onReopen?: () => void;
  /** The registration to place; undefined keeps the shared Dialog closed. */
  readonly location: NamedLocationTarget | undefined;
  readonly onClose: () => void;
  readonly onCompleted: (result: { code: string; floorNumber: number }) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const dialogRef = useRef<DialogCompletionHandle>(null);
  // The write is owned here, beside its Dialog, so the render that ends the
  // write also unblocks the Dialog before the live completion consumes it.
  const operation = useAsyncOperation({
    scope: `named-layout:${warehouseId}:${location?.locationId ?? ""}`,
    describeError: (code) => code || "NETWORK_ERROR",
    navigation: "write",
  });
  // Always mounted, so open/close/completion own one foreground entry.
  return (
    <Dialog
      open={location !== undefined}
      onOpenChange={(open) => {
        if (open) onReopen?.();
        else onClose();
      }}
      backPending={operation.busy}
      completionRef={dialogRef}
    >
      {location === undefined ? null : (
        <DialogContent closeLabel={t("closeDialog")} className="max-w-2xl">
          <CompleteNamedLayoutForm
            key={location.locationId}
            warehouseId={warehouseId}
            location={location}
            operation={operation}
            // The Dialog consumes its own entry, then the receipt is shown.
            onCompleted={(result) =>
              dialogRef.current?.complete(() => onCompleted(result))
            }
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function CompleteNamedLayoutForm({
  warehouseId,
  location,
  operation,
  onCompleted,
}: {
  readonly warehouseId: string;
  readonly location: NamedLocationTarget;
  readonly operation: ReturnType<typeof useAsyncOperation>;
  readonly onCompleted: (result: { code: string; floorNumber: number }) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const target = useQuery(storageLayoutRefs.namedLayoutTarget, {
    warehouseId,
    locationId: location.locationId,
  });
  const layout = useQuery(storageLayoutRefs.layout, {
    warehouseId,
    buildingId: location.buildingId,
  });
  const complete = useMutation(storageLayoutRefs.completeNamedLayout);
  const lastCommand = useRef<{
    command: Parameters<typeof complete>[0];
    submitted: string;
  }>(undefined);
  const detail: StorageBuildingDetail | undefined = layout?.ok
    ? layout.value
    : undefined;
  const floors = detail?.found ? detail.floors : [];
  const [floorNumber, setFloorNumber] = useState(
    String(location.floorNumber ?? 1),
  );
  const [draft, setDraft] = useState({
    x: "",
    y: "",
    width: "",
    depth: "",
    height: "",
  });
  const [refusal, setRefusal] = useState<string>();
  const [noRoom, setNoRoom] = useState(false);
  // The submitted form intent includes the local floor choice. A live query
  // may assign the saved floor before its response arrives, so comparing the
  // resolved floor alone would hide a newer local choice.
  const draftSnapshot = JSON.stringify({ floorNumber, draft });
  // The exact intent that was saved; anything typed later remains a draft.
  const [savedSnapshot, setSavedSnapshot] = useState<string>();
  const [cleared, setCleared] = useState(false);
  // Unsent measurements are this dialog's own draft: closing asks first.
  useNavigationDraft({
    dirty:
      !cleared &&
      draftSnapshot !== savedSnapshot &&
      Object.values(draft).some((value) => value !== ""),
    pending: operation.busy,
    discard: () => setCleared(true),
  });
  const value = target?.ok ? target.value : undefined;
  // Job records keep a registered floor, so an assigned floor is fixed; only
  // an unassigned registration may choose one (NAMED_LOCATION_FLOOR_CONFLICT).
  const assignedFloor =
    value?.found === true && typeof value.floorNumber === "number"
      ? value.floorNumber
      : undefined;
  const chosenFloor = String(assignedFloor ?? floorNumber);
  const floor = floors.find((row) => row.floorNumber === Number(chosenFloor));
  const building = detail?.found ? detail.building : undefined;
  const floorWidthMm = floor?.widthMm ?? building?.widthMm ?? 0;
  const floorDepthMm = floor?.depthMm ?? building?.depthMm ?? 0;
  const floorHeightMm = floor?.heightMm ?? building?.defaultFloorHeightMm ?? 0;
  const mm = {
    xMm: measuredMillimetres(draft.x),
    yMm: measuredMillimetres(draft.y),
    widthMm: measuredMillimetres(draft.width),
    depthMm: measuredMillimetres(draft.depth),
  };
  const heightMm = measuredMillimetres(draft.height);
  const areas = floor
    ? [
        ...floor.reservedBlocks.map((area) => ({
          ...area,
          kind: "unavailable" as const,
        })),
        ...floor.storageZones.map((area) => ({
          ...area,
          label: `${area.code} ${area.label}`,
          kind: "spot" as const,
        })),
      ]
    : [];
  const rectangle =
    mm.xMm === null ||
    mm.yMm === null ||
    mm.widthMm === null ||
    mm.depthMm === null
      ? null
      : (mm as Record<keyof typeof mm, number>);
  const problem = floor
    ? placementProblem({
        draft: rectangle,
        heightMm,
        floorWidthMm,
        floorDepthMm,
        floorHeightMm,
        areas,
      })
    : { kind: "incomplete" as const };
  const pending = value?.found === true && value.layoutPending === true;
  const archived = value?.found === true && value.buildingStatus === "ARCHIVED";
  const ready =
    pending && !archived && problem === null && rectangle !== null && heightMm;
  async function submit() {
    if (!ready || !value?.found || rectangle === null || heightMm === null)
      return;
    const payload = {
      warehouseId,
      locationId: location.locationId,
      buildingId: location.buildingId,
      expectedVersion: value.version,
      floorNumber: Number(chosenFloor),
      ...rectangle,
      maxStackHeightMm: heightMm,
    };
    const command = {
      ...payload,
      requestId: operation.request(JSON.stringify(payload)),
    };
    const submitted = draftSnapshot;
    lastCommand.current = { command, submitted };
    await send(command, submitted);
  }
  async function send(
    command: Parameters<typeof complete>[0],
    submitted: string,
  ) {
    if (operation.busy) return;
    setRefusal(undefined);
    await operation.run(
      () => complete(command),
      (result) => {
        if (!result.ok) setRefusal(result.denial.code);
        else if (!result.value.written) setRefusal(result.value.error.code);
        else {
          operation.clearRequests();
          lastCommand.current = undefined;
          setSavedSnapshot(submitted);
          // Close and report only once the write has settled (live owner).
          operation.complete(() =>
            onCompleted({
              code: location.code,
              floorNumber: command.floorNumber,
            }),
          );
        }
      },
    );
  }
  const problemText =
    problem === null
      ? t("zoneFitsFloor")
      : problem.kind === "incomplete"
        ? t("layoutActions.named.measuredRequired")
        : problem.kind === "outside"
          ? t("layoutActions.placement.outside", {
              width: metres(floorWidthMm),
              depth: metres(floorDepthMm),
            })
          : problem.kind === "tooHigh"
            ? t("layoutActions.placement.tooHigh", {
                height: metres(floorHeightMm),
              })
            : t("layoutActions.placement.overlaps", {
                names: problem.names.join(", "),
              });
  const field = (key: keyof typeof draft, label: string) => (
    <div key={key}>
      <Label htmlFor={`named-layout-${key}`}>{label}</Label>
      <MeasureInput
        id={`named-layout-${key}`}
        className="mt-2"
        min={key === "x" || key === "y" ? 0 : 0.001}
        value={draft[key]}
        onChange={(event) => {
          setNoRoom(false);
          setDraft((current) => ({ ...current, [key]: event.target.value }));
        }}
      />
    </div>
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("layoutActions.named.completeTitle", { code: location.code })}
        </DialogTitle>
        <DialogDescription>
          {t("layoutActions.named.completeDescription")}
        </DialogDescription>
      </DialogHeader>
      {archived ? (
        <Notice
          tone="warning"
          title={t("layoutActions.named.buildingArchived")}
        />
      ) : value?.found && !pending ? (
        <Notice tone="muted" title={t("layoutActions.named.alreadyMapped")} />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="named-layout-floor">
            {t("layoutActions.named.floor")}
          </Label>
          <SelectControl
            id="named-layout-floor"
            className="mt-2 w-full"
            label={t("layoutActions.named.floor")}
            value={chosenFloor}
            onValueChange={setFloorNumber}
            disabled={assignedFloor !== undefined}
            placeholder={t("layoutActions.named.floor")}
            emptyLabel={t("layoutActions.named.floor")}
            options={floors.map((row) => ({
              value: String(row.floorNumber),
              label: `${t("floor", { floor: row.floorNumber })} · ${metres(row.widthMm ?? building?.widthMm ?? 0)} × ${metres(row.depthMm ?? building?.depthMm ?? 0)} m`,
            }))}
          />
          {assignedFloor === undefined ? null : (
            <p
              className="mt-2 text-xs text-muted"
              data-testid="named-floor-locked"
            >
              {t("layoutActions.named.floorLocked", { floor: assignedFloor })}
            </p>
          )}
        </div>
        {field("width", t("zoneWidth"))}
        {field("depth", t("zoneDepth"))}
        {field("x", t("x"))}
        {field("y", t("y"))}
        {field("height", t("maxStackHeight"))}
        <div className="self-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!floor || mm.widthMm === null || mm.depthMm === null}
            onClick={() => {
              if (!floor || mm.widthMm === null || mm.depthMm === null) return;
              const found = findFreePlacement(
                floorWidthMm,
                floorDepthMm,
                mm.widthMm,
                mm.depthMm,
                areas,
              );
              setNoRoom(found === null);
              if (found)
                setDraft((current) => ({
                  ...current,
                  x: String(metres(found.xMm)),
                  y: String(metres(found.yMm)),
                }));
            }}
          >
            {t("layoutActions.placement.findSpace")}
          </Button>
        </div>
      </div>
      {noRoom ? (
        <Notice
          tone="warning"
          role="status"
          title={t("layoutActions.placement.noRoom", {
            width: draft.width,
            depth: draft.depth,
          })}
          body={t("layoutActions.placement.noRoomHelp")}
        />
      ) : null}
      <p
        className={`text-xs ${problem === null ? "text-muted" : "text-warning"}`}
        aria-live="polite"
        data-testid="named-layout-status"
      >
        {problemText}
      </p>
      <OperationFailure
        failure={layoutFailure(refusal, operation)}
        onRetry={() => {
          // The committed location may no longer be layoutPending; only the
          // exact submitted command bypasses that UI preflight for recovery.
          if (lastCommand.current)
            void send(
              lastCommand.current.command,
              lastCommand.current.submitted,
            );
        }}
        retrying={operation.busy}
      />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={operation.busy}>
            {t("cancel")}
          </Button>
        </DialogClose>
        <Button
          type="button"
          disabled={!ready || operation.busy}
          onClick={() => void submit()}
        >
          {operation.busy
            ? t("layoutActions.named.saving")
            : t("layoutActions.named.confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
