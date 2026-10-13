"use client";
import { updateBrowserQuery } from "@/lib/browser/history";
import { useWorkspaceQuery, workspaceStateEvent } from "./useWorkspaceQuery";

import { useStorageLayoutMobile } from "@/components/storageLayouts/useStorageLayoutMobile";
import canvasStyles from "@/components/storageLayouts/FloorMap.module.css";
import { createPortal } from "react-dom";
import { LocationDetailsHost } from "@/components/storageLayouts/LocationDetailsHost";

import { StorageZoneDraftPreview } from "@/components/storageLayouts/StorageZoneDraftPreview";

import { useMutation } from "convex/react";
import { useWorkflowStep } from "@/hooks/useWorkflowStep";
import { useNavigationDraft } from "@/components/navigation/navigationDraft";
import {
  Archive,
  ArrowRightLeft,
  Eye,
  PencilLine,
  Plus,
  QrCode,
  Search,
  X,
  Zap,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { QrCode as LocationQrCode } from "@/features/storageKit/QrCode";
import {
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/Notice";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusReason } from "@/components/ui/StatusReason";
import { Link } from "@/i18n/navigation";
import {
  storageLayoutRefs,
  type StorageLayoutStatus,
  type StorageZoneRow,
} from "@/lib/convex/storageLayoutApi";
import {
  locationInventory,
  matchingStorageLocations,
} from "@/lib/storageLayouts/locationSelectors";
import { placementStatusKey } from "@/lib/storageLayouts/storageKit";

import { useCanManage } from "@/hooks/useCanManage";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import { palletPath } from "@/lib/navigation";

import { metres } from "./storageLayoutShared";
import {
  BlockedImpact,
  layoutFailure,
  MeasureInput,
  OperationFailure,
  storageWriteMessage,
} from "./layoutActions";
import { ListTree } from "lucide-react";
import { measuredMillimetres, whenGuardIdle } from "./measure";
import { findFreePlacement, placementProblem } from "./zonePlacement";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StoragePositionsDialog } from "./StoragePositionsDialog";
import type { StorageAreaMode } from "@/lib/convex/storageLayoutApi";
import type { EditableBlock } from "./types";
import { PlacementStatusBadge } from "@/features/storageKit/PlacementStatusBadge";

export function StorageZonesPanel({
  panelRef,
  onSelectionClose,
  editRequest,
  compact = false,
  selectedZoneId,
  warehouseId,
  buildingId,
  floorNumber,
  floorWidthMm,
  floorDepthMm,
  floorHeightMm,
  zones,
  reservedBlocks = [],
  layoutStatus = "DRAFT",
  blocked = false,
  onEditorOpenChange,
  onSavingChange,
}: {
  readonly panelRef?: Ref<{
    create: () => void;
  }>;
  readonly onSelectionClose?: () => void;
  readonly editRequest?:
    { readonly zoneId: string; readonly nonce: number } | undefined;
  readonly compact?: boolean;
  readonly selectedZoneId?: string | undefined;
  readonly warehouseId: string;
  readonly buildingId: string;
  readonly floorNumber: number;
  readonly floorWidthMm: number;
  readonly floorDepthMm: number;
  readonly floorHeightMm: number;
  readonly zones: readonly StorageZoneRow[];
  readonly reservedBlocks?: readonly EditableBlock[];
  readonly layoutStatus?: StorageLayoutStatus;
  readonly blocked?: boolean;
  readonly onEditorOpenChange?: (open: boolean) => void;
  readonly onSavingChange?: (saving: boolean) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const detailsHost = useContext(LocationDetailsHost);
  const mobile = useStorageLayoutMobile();
  const [search, setSearch] = useState("");
  const searchId = useId();
  const visibleZones = useMemo(() => {
    if (compact) return zones.filter((zone) => zone.zoneId === selectedZoneId);
    return matchingStorageLocations(zones, search);
  }, [search, zones, compact, selectedZoneId]);
  const canManage = useCanManage();
  const editable = canManage && layoutStatus !== "ARCHIVED";
  const createZone = useMutation(storageLayoutRefs.createZone);
  const updateZone = useMutation(storageLayoutRefs.updateZone);
  const archiveZone = useMutation(storageLayoutRefs.archiveZone);
  const operation = useAsyncOperation({
    scope: `storage-zones:${warehouseId}:${buildingId}:${floorNumber}`,
    describeError: (code) => code || "NETWORK_ERROR",
    navigation: "write",
  });
  const [label, setLabel] = useState("");
  const [storageCondition, setStorageCondition] = useState("ANY");
  const [zoneX, setZoneX] = useState("0");
  const [zoneY, setZoneY] = useState("0");
  const [zoneWidth, setZoneWidth] = useState("2");
  const [zoneDepth, setZoneDepth] = useState("2");
  const [stackHeight, setStackHeight] = useState(String(metres(floorHeightMm)));
  const [mode, setMode] = useState<StorageAreaMode>("SIMPLE");
  const [baseElevation, setBaseElevation] = useState("");
  const [refusal, setRefusal] = useState<string>();
  const [noRoom, setNoRoom] = useState(false);
  // The revision the open draft is based on; a conflict keeps the draft (F19).
  const [draftRevision, setDraftRevision] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [archiving, setArchiving] = useState<StorageZoneRow>();
  const [positionsZoneId, setPositionsZoneId] = useState<string>();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string>();
  const [closeAfterSave, setCloseAfterSave] = useState(false);
  const editorOpen = createDialogOpen && editable;
  useLayoutEffect(() => {
    onEditorOpenChange?.(editorOpen);
    return () => onEditorOpenChange?.(false);
  }, [editorOpen, onEditorOpenChange]);
  const [editingZone, setEditingZone] = useState<StorageZoneRow>();
  const followedAnchor = useRef<string | undefined>(undefined);
  useEffect(() => {
    const followAnchor = () => {
      const id = window.location.hash.slice(1);
      if (
        id !== "storage-stacks-section" &&
        !zones.some((zone) => id === `storage-zone-${zone.zoneId}`)
      )
        return;
      const target = document.getElementById(id);
      const key = `${warehouseId}:${buildingId}:${floorNumber}:${id}`;
      if (!target || followedAnchor.current === key) return;
      followedAnchor.current = key;
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: "start" });
    };
    // Floor data arrives after the browser's initial fragment navigation.
    followAnchor();
    const onHashChange = () => {
      followedAnchor.current = undefined;
      if (
        zones.some(
          (zone) => window.location.hash === `#storage-zone-${zone.zoneId}`,
        )
      )
        setSearch("");
      followAnchor();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [warehouseId, buildingId, floorNumber, zones, visibleZones]);
  // The editor Dialog owns its foreground entry under this draft scope; the
  // stock-blocked review is a later step inside it (F13), so Back returns to
  // the same spot draft and leaves the editor open.
  const editorScope = `storage-zone-editor:${warehouseId}:${buildingId}:${floorNumber}`;
  const impactScope = `storage-zone-impact:${warehouseId}:${buildingId}:${floorNumber}`;
  const impactStep = useWorkflowStep(
    "zoneImpact",
    impactScope,
    editorOpen,
    undefined,
    { priority: 110, blocked: pendingAction !== undefined },
  );
  const confirmingImpact = impactStep.active;
  const setConfirmingImpact = (open: boolean) => {
    if (open && !impactStep.active) impactStep.enter();
    if (!open && impactStep.active) impactStep.back();
  };
  const [editorBaseline, setEditorBaseline] = useState("");
  const editorSnapshot = JSON.stringify([
    label,
    storageCondition,
    zoneX,
    zoneY,
    zoneWidth,
    zoneDepth,
    stackHeight,
    mode,
    baseElevation,
  ]);
  // The open editor's own unsent values: closing it (Cancel, Close, Back)
  // asks first; its impact review retains them.
  useNavigationDraft({
    dirty: editorOpen && editorSnapshot !== editorBaseline,
    pending: pendingAction !== undefined,
    // The approved navigation itself closes the editor; discarding only
    // releases its protection so that close is not asked twice.
    discard: () => setEditorBaseline(editorSnapshot),
    foregroundScope: editorScope,
    workflowScope: impactScope,
  });
  // A successful write closes the editor only after its pending write and
  // draft registration have settled, so closing consumes the editor entry
  // instead of being blocked or reopening a stale editor.
  useEffect(() => {
    if (!closeAfterSave || operation.busy || pendingAction !== undefined)
      return;
    // Effects run after every layout effect of this commit, so the editor's
    // draft registration already reports clean when its entry is consumed.
    queueMicrotask(() =>
      whenGuardIdle(() => {
        setCloseAfterSave(false);
        setCreateDialogOpen(false);
        setEditingZone(undefined);
        setLabel("");
        clearZoneIntent();
      }),
    );
  }, [closeAfterSave, operation.busy, pendingAction]);
  useLayoutEffect(() => {
    onSavingChange?.(pendingAction !== undefined);
    return () => onSavingChange?.(false);
  }, [pendingAction, onSavingChange]);
  const [message, setMessage] = useState<{
    readonly tone: "success" | "warning";
    readonly text: string;
  }>();
  function loadZone(zone: StorageZoneRow) {
    setCloseAfterSave(false);
    setEditingZone(zone);
    setLabel(zone.label);
    setStorageCondition(zone.storageCondition?.trim().toUpperCase() || "ANY");
    setZoneX(String(metres(zone.xMm)));
    setZoneY(String(metres(zone.yMm)));
    setZoneWidth(String(metres(zone.widthMm)));
    setZoneDepth(String(metres(zone.depthMm)));
    setStackHeight(String(metres(zone.maxStackHeightMm)));
    setMode(zone.mode);
    setBaseElevation(
      zone.baseElevationMm === undefined
        ? ""
        : String(metres(zone.baseElevationMm)),
    );
    setDraftRevision(zone.revision);
    setConflict(false);
    setRefusal(undefined);
    setNoRoom(false);
    setEditorBaseline(
      JSON.stringify([
        zone.label,
        zone.storageCondition?.trim().toUpperCase() || "ANY",
        String(metres(zone.xMm)),
        String(metres(zone.yMm)),
        String(metres(zone.widthMm)),
        String(metres(zone.depthMm)),
        String(metres(zone.maxStackHeightMm)),
        zone.mode,
        zone.baseElevationMm === undefined
          ? ""
          : String(metres(zone.baseElevationMm)),
      ]),
    );
  }
  const zoneQuery = useWorkspaceQuery();
  const openedFromLink = useRef<string | number | undefined>(undefined);
  function clearZoneIntent() {
    if (!new URLSearchParams(window.location.search).has("editZone")) return;
    updateBrowserQuery((query) => query.delete("editZone"), {
      event: workspaceStateEvent,
    });
  }
  useEffect(() => {
    const requested =
      new URLSearchParams(zoneQuery).get("editZone") ?? editRequest?.zoneId;
    const requestKey = editRequest?.nonce ?? requested;
    if (requested == null) {
      openedFromLink.current = undefined;
      return;
    }
    const zone = zones.find((item) => item.zoneId === requested);
    if (
      editable &&
      zone &&
      requestKey != null &&
      openedFromLink.current !== requestKey
    ) {
      openedFromLink.current = requestKey;
      setMessage(undefined);
      loadZone(zone);
      setCreateDialogOpen(true);
    }
  }, [editable, zones, editRequest, zoneQuery]);
  const measured = {
    xMm: measuredMillimetres(zoneX),
    yMm: measuredMillimetres(zoneY),
    widthMm: measuredMillimetres(zoneWidth),
    depthMm: measuredMillimetres(zoneDepth),
  };
  const zoneDraft = {
    xMm: measured.xMm ?? Number.NaN,
    yMm: measured.yMm ?? Number.NaN,
    widthMm: measured.widthMm ?? Number.NaN,
    depthMm: measured.depthMm ?? Number.NaN,
  };
  const stackHeightMm = measuredMillimetres(stackHeight);
  const baseElevationMm =
    mode === "PLATFORM" ? measuredMillimetres(baseElevation) : null;
  const normalizedCondition = (condition: string | undefined) => {
    const normalized = condition?.trim().toUpperCase();
    return normalized === "ANY" ? "" : (normalized ?? "");
  };
  const editingStock =
    editingZone === undefined
      ? 0
      : editingZone.placements.length +
        (editingZone.unmeasuredPalletCount ?? 0);
  const occupiedChangeBlocked =
    editingZone !== undefined &&
    editingStock > 0 &&
    (zoneDraft.xMm !== editingZone.xMm ||
      zoneDraft.yMm !== editingZone.yMm ||
      zoneDraft.widthMm !== editingZone.widthMm ||
      zoneDraft.depthMm !== editingZone.depthMm ||
      stackHeightMm !== editingZone.maxStackHeightMm ||
      mode !== editingZone.mode ||
      (mode === "PLATFORM" &&
        baseElevationMm !== (editingZone.baseElevationMm ?? null)) ||
      normalizedCondition(storageCondition) !==
        normalizedCondition(editingZone.storageCondition));
  const otherZones =
    editingZone === undefined
      ? zones
      : zones.filter((zone) => zone.zoneId !== editingZone.zoneId);
  const exactPositionCount = (zone: StorageZoneRow) =>
    zone.positions.filter((position) => !position.isDefault).length;
  // Mirrors the server rule: returning to SIMPLE needs exact positions archived.
  const simpleBlocked =
    editingZone !== undefined &&
    editingZone.mode !== "SIMPLE" &&
    mode === "SIMPLE" &&
    exactPositionCount(editingZone) > 0;
  const problem = placementProblem({
    draft:
      measured.xMm === null ||
      measured.yMm === null ||
      measured.widthMm === null ||
      measured.depthMm === null
        ? null
        : (zoneDraft as {
            xMm: number;
            yMm: number;
            widthMm: number;
            depthMm: number;
          }),
    heightMm: stackHeightMm,
    floorWidthMm,
    floorDepthMm,
    floorHeightMm,
    areas: [
      ...reservedBlocks.map((area) => ({
        ...area,
        kind: "unavailable" as const,
      })),
      ...otherZones.map((area) => ({
        ...area,
        label: `${area.code} ${area.label}`,
        kind: "spot" as const,
      })),
    ],
  });
  const platformValid =
    mode !== "PLATFORM" ||
    (baseElevationMm !== null &&
      stackHeightMm !== null &&
      baseElevationMm + stackHeightMm <= floorHeightMm);
  const storageDraftValid = problem === null && platformValid && !simpleBlocked;
  const problemText =
    problem === null
      ? undefined
      : problem.kind === "incomplete"
        ? t("layoutActions.placement.incomplete")
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

  /** Place the requested footprint in the first free gap, or report no room. */
  const placeDraft = (widthMm: number, depthMm: number) => {
    const position = findFreePlacement(
      floorWidthMm,
      floorDepthMm,
      widthMm,
      depthMm,
      [...reservedBlocks, ...otherZones],
    );
    setNoRoom(position === null);
    if (position !== null) {
      setZoneX(String(metres(position.xMm)));
      setZoneY(String(metres(position.yMm)));
    }
    return position;
  };

  const startNewStorageZone = () => {
    if (!editable || blocked) return;
    setCloseAfterSave(false);
    setEditingZone(undefined);
    setLabel("");
    setStorageCondition("ANY");
    setZoneWidth("2");
    setZoneDepth("2");
    setStackHeight(String(metres(floorHeightMm)));
    setMode("SIMPLE");
    setBaseElevation("");
    setDraftRevision(undefined);
    setConflict(false);
    setRefusal(undefined);
    const position = findFreePlacement(
      floorWidthMm,
      floorDepthMm,
      2_000,
      2_000,
      [...reservedBlocks, ...zones],
    );
    // No overlapping fallback (F17): leave X/Y empty and say why.
    setNoRoom(position === null);
    setZoneX(position === null ? "" : String(metres(position.xMm)));
    setZoneY(position === null ? "" : String(metres(position.yMm)));
    setEditorBaseline(
      JSON.stringify([
        "",
        "ANY",
        position === null ? "" : String(metres(position.xMm)),
        position === null ? "" : String(metres(position.yMm)),
        "2",
        "2",
        String(metres(floorHeightMm)),
        "SIMPLE",
        "",
      ]),
    );
    setConfirmingImpact(false);
    setMessage(undefined);
  };

  useImperativeHandle(panelRef, () => ({
    create: () => {
      if (!editable || blocked || pendingAction !== undefined) return;
      startNewStorageZone();
      setCreateDialogOpen(true);
    },
  }));

  const startEditingStorageZone = (zone: StorageZoneRow) => {
    if (!editable || blocked) return;
    loadZone(zone);
    setConfirmingImpact(false);
    setMessage(undefined);
    setCreateDialogOpen(true);
  };

  const saveStorageZone = async () => {
    if (!editable || blocked || !storageDraftValid) return;
    if (occupiedChangeBlocked) {
      setConfirmingImpact(true);
      return;
    }
    const isEditing = editingZone !== undefined;
    setPendingAction(isEditing ? "update" : "create");
    setMessage(undefined);
    setRefusal(undefined);
    try {
      const draft = {
        warehouseId,
        label: label || t("newStorageZoneLabel", { number: zones.length + 1 }),
        xMm: zoneDraft.xMm,
        yMm: zoneDraft.yMm,
        widthMm: zoneDraft.widthMm,
        depthMm: zoneDraft.depthMm,
        maxStackHeightMm: stackHeightMm ?? Number.NaN,
        storageCondition: storageCondition === "ANY" ? "" : storageCondition,
        mode,
        ...(mode === "PLATFORM" && baseElevationMm !== null
          ? { baseElevationMm }
          : {}),
      };
      // Each branch keeps its own payload; one current completion handles
      // the shared create/update outcome. The server refuses structural
      // changes under stock, so no override flag is ever sent.
      const send =
        editingZone !== undefined
          ? () => {
              const payload = {
                ...draft,
                zoneId: editingZone.zoneId,
                ...(draftRevision === undefined
                  ? {}
                  : { expectedRevision: draftRevision }),
              };
              return updateZone({
                ...payload,
                requestId: operation.request(JSON.stringify(payload)),
              });
            }
          : () => {
              const payload = { ...draft, buildingId, floorNumber };
              return createZone({
                ...payload,
                requestId: operation.request(JSON.stringify(payload)),
              });
            };
      await operation.run(send, (outcome) => {
        const code = !outcome.ok
          ? outcome.denial.code
          : !outcome.value.written
            ? outcome.value.error.code
            : undefined;
        if (code === "VERSION_CONFLICT" && isEditing) {
          setConflict(true);
          return;
        }
        if (code !== undefined) {
          setRefusal(code);
          return;
        }
        operation.clearRequests();
        // Saved: nothing is left to protect, then close once settled.
        setEditorBaseline(editorSnapshot);
        setCloseAfterSave(true);
        setMessage({
          tone: "success",
          text:
            mode !== "SIMPLE" && !isEditing
              ? `${t("storageZoneCreated")} ${t("layoutActions.modeExactRequired")}`
              : t(isEditing ? "storageZoneUpdated" : "storageZoneCreated"),
        });
      });
    } finally {
      setPendingAction(undefined);
    }
  };

  /** Reload the latest saved spot into the editor, discarding the draft. */
  const loadLatest = () => {
    const latest = zones.find((zone) => zone.zoneId === editingZone?.zoneId);
    if (latest) loadZone(latest);
    else setCreateDialogOpen(false);
  };
  /** Keep the draft but base it on the latest version, for an explicit re-save. */
  const keepDraft = () => {
    const latest = zones.find((zone) => zone.zoneId === editingZone?.zoneId);
    if (!latest) return;
    setEditingZone(latest);
    setDraftRevision(latest.revision);
    setConflict(false);
    setMessage({ tone: "success", text: t("layoutActions.conflict.rebased") });
  };

  const [archiveRefusal, setArchiveRefusal] = useState<string>();
  const removeStorageZone = async (zone: StorageZoneRow) => {
    if (!editable || blocked) return;
    setPendingAction(zone.zoneId);
    setMessage(undefined);
    setArchiveRefusal(undefined);
    try {
      const payload = {
        warehouseId,
        zoneId: zone.zoneId,
      };
      await operation.run(
        () =>
          archiveZone({
            ...payload,
            requestId: operation.request(JSON.stringify(payload)),
          }),
        (outcome) => {
          if (!outcome.ok) setArchiveRefusal(outcome.denial.code);
          else if (!outcome.value.written)
            setArchiveRefusal(outcome.value.error.code);
          else {
            operation.clearRequests();
            setArchiving(undefined);
            setMessage({ tone: "success", text: t("storageZoneArchived") });
          }
        },
      );
    } finally {
      setPendingAction(undefined);
    }
  };
  const archiveFailure = layoutFailure(archiveRefusal, operation);
  const requestArchive = (zone: StorageZoneRow) => {
    if (!editable || blocked) return;
    setArchiveRefusal(undefined);
    setArchiving(zone);
  };

  const editorDialog = (
    <Dialog
      open={editorOpen}
      draftScope={editorScope}
      backPending={pendingAction !== undefined}
      onOpenChange={(open) => {
        if (open && !editable) return;
        // Closing during the impact review returns to the draft first.
        if (!open && impactStep.active) {
          impactStep.back();
          return;
        }
        setCreateDialogOpen(open);
        if (open) setMessage(undefined);
        else {
          clearZoneIntent();
          setEditingZone(undefined);
          setLabel("");
          setConflict(false);
          setRefusal(undefined);
        }
      }}
    >
      {!compact ? (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={t("addStorageZone")}
            title={t("addStorageZone")}
            className="shrink-0 px-3"
            onClick={startNewStorageZone}
            disabled={!editable || blocked}
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("addStorageZone")}</span>
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent closeLabel={t("closeDialog")} className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {t(
              editingZone === undefined
                ? "addStorageZoneTitle"
                : "editStorageZoneTitle",
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              editingZone === undefined
                ? "addStorageZoneDescription"
                : "editStorageZoneDescription",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1.05fr)_minmax(19rem,0.95fr)]">
          <StorageZoneDraftPreview
            floorWidthMm={floorWidthMm}
            floorDepthMm={floorDepthMm}
            floorHeightMm={floorHeightMm}
            zoneX={zoneX}
            zoneY={zoneY}
            zoneWidth={zoneWidth}
            zoneDepth={zoneDepth}
            stackHeight={stackHeight}
            zones={otherZones}
            {...(editingZone ? { editingZone } : {})}
            reservedBlocks={reservedBlocks}
            onPositionChange={({ xMm, yMm }) => {
              setZoneX(String(metres(xMm)));
              setZoneY(String(metres(yMm)));
            }}
          />
          <div className="grid content-start gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="new-storage-zone-label">{t("zoneLabel")}</Label>
              <Input
                id="new-storage-zone-label"
                className="mt-2"
                value={label}
                placeholder={t("newStorageZoneLabel", {
                  number: zones.length + 1,
                })}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            {noRoom ? (
              <div className="sm:col-span-2">
                <Notice
                  tone="warning"
                  role="status"
                  title={t("layoutActions.placement.noRoom", {
                    width: zoneWidth || "—",
                    depth: zoneDepth || "—",
                  })}
                  body={t("layoutActions.placement.noRoomHelp")}
                />
              </div>
            ) : null}
            {(
              [
                ["x", zoneX, setZoneX, 0, floorWidthMm],
                ["y", zoneY, setZoneY, 0, floorDepthMm],
                ["zoneWidth", zoneWidth, setZoneWidth, 0.001, floorWidthMm],
                ["zoneDepth", zoneDepth, setZoneDepth, 0.001, floorDepthMm],
              ] as const
            ).map(([key, value, setValue, min, max]) => (
              <div key={key}>
                <Label htmlFor={`new-storage-zone-${key}`}>{t(key)}</Label>
                <MeasureInput
                  id={`new-storage-zone-${key}`}
                  className="mt-2"
                  min={min}
                  max={metres(max)}
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setConflict(false);
                  }}
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={
                  measured.widthMm === null || measured.depthMm === null
                }
                onClick={() =>
                  measured.widthMm !== null &&
                  measured.depthMm !== null &&
                  placeDraft(measured.widthMm, measured.depthMm)
                }
              >
                {t("layoutActions.placement.findSpace")}
              </Button>
              <p
                className={`mt-1 text-xs ${problemText ? "text-warning" : "text-muted"}`}
                aria-live="polite"
                data-testid="zone-placement-status"
              >
                {problemText ?? t("zoneFitsFloor")}
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="new-storage-zone-mode">{t("areaMode")}</Label>
              <SelectControl
                id="new-storage-zone-mode"
                className="mt-2 w-full"
                label={t("areaMode")}
                value={mode}
                onValueChange={(value) => setMode(value as StorageAreaMode)}
                placeholder={t("modeSimple")}
                emptyLabel={t("modeSimple")}
                options={(
                  [
                    ["SIMPLE", "modeSimple"],
                    ["FLOOR_POSITIONS", "modeFloorPositions"],
                    ["RACK", "modeRack"],
                    ["PLATFORM", "modePlatform"],
                  ] as const
                ).map(([value, key]) => ({ value, label: t(key) }))}
              />
              <p className="mt-2 text-xs text-muted">
                {t(
                  mode === "SIMPLE"
                    ? "modeSimpleRule"
                    : mode === "FLOOR_POSITIONS"
                      ? "modeFloorPositionsRule"
                      : mode === "RACK"
                        ? "modeRackRule"
                        : "modePlatformRule",
                )}
              </p>
              {simpleBlocked ? (
                <p className="mt-1 text-xs text-warning" role="status">
                  {t("layoutActions.modeSimpleBlocked")}
                </p>
              ) : mode !== "SIMPLE" &&
                (editingZone === undefined ||
                  exactPositionCount(editingZone) === 0) ? (
                <p className="mt-1 text-xs text-muted">
                  {t("layoutActions.modeExactRequired")}
                </p>
              ) : null}
            </div>
            {mode === "PLATFORM" ? (
              <div className="sm:col-span-2">
                <Label htmlFor="new-storage-zone-base">
                  {t("baseElevation")}
                </Label>
                <MeasureInput
                  id="new-storage-zone-base"
                  className="mt-2"
                  min={0}
                  max={metres(floorHeightMm)}
                  value={baseElevation}
                  onChange={(event) => setBaseElevation(event.target.value)}
                />
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <Label htmlFor="new-storage-zone-condition">
                {t("storageCondition")}
              </Label>
              <SelectControl
                id="new-storage-zone-condition"
                className="mt-2 w-full"
                value={storageCondition}
                onValueChange={setStorageCondition}
                placeholder={t("storageConditionUnknown")}
                emptyLabel={t("storageConditionUnknown")}
                options={[
                  { value: "ANY", label: t("storageConditionUnknown") },
                  { value: "DRY", label: t("storageConditionDry") },
                  { value: "COOL", label: t("storageConditionCool") },
                  ...(["ANY", "DRY", "COOL"].includes(storageCondition)
                    ? []
                    : [
                        {
                          value: storageCondition,
                          label: storageCondition,
                        },
                      ]),
                ]}
              />
              <p className="mt-2 text-xs text-muted">
                {t("storageConditionHelp")}
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="new-storage-zone-height">
                {t("maxStackHeight")}
              </Label>
              <MeasureInput
                id="new-storage-zone-height"
                className="mt-2"
                min={0.001}
                max={metres(floorHeightMm)}
                value={stackHeight}
                onChange={(event) => setStackHeight(event.target.value)}
              />
            </div>
          </div>
        </div>
        {message === undefined ? null : (
          <Notice tone={message.tone} title={message.text} />
        )}
        {conflict ? (
          <Notice
            tone="warning"
            role="alert"
            title={t("layoutActions.conflict.title")}
            body={t("layoutActions.conflict.description")}
            testId="zone-version-conflict"
          >
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={loadLatest}
              >
                {t("layoutActions.conflict.loadLatest")}
              </Button>
              <Button type="button" size="sm" onClick={keepDraft}>
                {t("layoutActions.conflict.keepDraft")}
              </Button>
            </div>
          </Notice>
        ) : null}
        <OperationFailure
          failure={layoutFailure(refusal, operation)}
          onRetry={() => void saveStorageZone()}
          retrying={pendingAction !== undefined}
        />
        {confirmingImpact && editingZone !== undefined ? (
          <BlockedImpact
            placements={editingZone.placements}
            unmeasuredCount={editingZone.unmeasuredPalletCount ?? 0}
            currentPlan={`${metres(editingZone.widthMm)} × ${metres(editingZone.depthMm)} × ${metres(editingZone.maxStackHeightMm)} m`}
            proposedPlan={`${zoneWidth} × ${zoneDepth} × ${stackHeight} m`}
            onBack={() => setConfirmingImpact(false)}
          />
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </DialogClose>
          {confirmingImpact ? null : (
            <Button
              type="button"
              onClick={() => void saveStorageZone()}
              disabled={
                pendingAction !== undefined ||
                !editable ||
                blocked ||
                conflict ||
                !storageDraftValid
              }
            >
              {editingZone === undefined ? (
                <Plus className="size-4" />
              ) : (
                <PencilLine className="size-4" />
              )}
              {pendingAction === "create"
                ? t("creating")
                : pendingAction === "update"
                  ? t("updating")
                  : occupiedChangeBlocked
                    ? t("reviewImpact")
                    : t(
                        editingZone === undefined
                          ? "createStorageZone"
                          : "saveStorageZoneChanges",
                      )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const locationDetails = (
    <div
      className={
        compact
          ? canvasStyles.details
          : "mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2"
      }
    >
      {visibleZones.map((zone) => {
        const distinctPositions = zone.positions.filter(
          (position) => position.qrValue !== zone.qrValue,
        );
        return (
          <article
            key={zone.zoneId}
            id={`storage-zone-${zone.zoneId}`}
            tabIndex={-1}
            aria-label={`${zone.label} · ${zone.code}`}
            className={
              compact
                ? "min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                : "min-w-0 scroll-mt-20 rounded-xl border border-border bg-background p-3 outline-none target:border-accent target:ring-1 target:ring-accent focus-visible:ring-2 focus-visible:ring-accent"
            }
          >
            {compact ? (
              <>
                <h3 className={canvasStyles.code}>{zone.code}</h3>
                <p className="mt-2 text-xs text-muted">
                  {zone.label} · {t("floor", { floor: floorNumber })}
                </p>
                <span className={canvasStyles.status}>
                  <span aria-hidden="true">●</span>
                  {locationInventory(zone).incomplete
                    ? t("locationTable.unmeasured")
                    : locationInventory(zone).stored > 0
                      ? t("locationTable.stored")
                      : locationInventory(zone).reserved > 0
                        ? t("placementReserved")
                        : t("locationTable.vacant")}
                </span>
                <dl className={canvasStyles.metrics}>
                  <div>
                    <dt>{t("canvasDimensions")}</dt>
                    <dd>
                      {metres(zone.widthMm)} × {metres(zone.depthMm)} m
                    </dd>
                  </div>
                  <div>
                    <dt>{t("canvasMaxHeight")}</dt>
                    <dd>{metres(zone.maxStackHeightMm)} m</dd>
                  </div>
                  <div>
                    <dt>{t("locationArea")}</dt>
                    <dd>
                      {(
                        (zone.widthMm * zone.depthMm) /
                        1_000_000
                      ).toLocaleString()}{" "}
                      m²
                    </dd>
                  </div>
                  <div>
                    <dt>{t("canvasStorageUnits")}</dt>
                    <dd>
                      {t("mapUnitCount", {
                        count: locationInventory(zone).units,
                      })}
                    </dd>
                  </div>
                </dl>
                <div className={canvasStyles.inventory}>
                  <strong>{t("canvasInventory")}</strong>
                  <p>
                    {[
                      ...new Set(
                        [
                          ...zone.placements,
                          ...(zone.locationOnlyPlacements ?? []),
                        ]
                          .map((p) => p.productName)
                          .filter(Boolean),
                      ),
                    ].join(", ") ||
                      (locationInventory(zone).units
                        ? t("palletsAtLocation", {
                            count: locationInventory(zone).units,
                          })
                        : t("noPalletsAtSpot"))}
                    {locationInventory(zone).units > 0 && (
                      <>
                        {" "}
                        ·{" "}
                        {t("mapUnitCount", {
                          count: locationInventory(zone).units,
                        })}
                      </>
                    )}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-start gap-3">
                  <details className="shrink-0">
                    <summary className="cursor-pointer text-sm text-link">
                      QR
                    </summary>
                    <LocationQrCode
                      value={zone.qrValue}
                      size={80}
                      padding={8}
                      level="M"
                      label={t("qrForZone", { code: zone.code })}
                      className="size-24 shrink-0 self-start p-2"
                    />{" "}
                  </details>

                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold break-words text-text">
                      {zone.label}
                    </h3>
                    <p className="mt-1 font-mono text-xs break-all text-muted">
                      {zone.code}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {metres(zone.widthMm)} × {metres(zone.depthMm)} m ·{" "}
                      {metres(zone.maxStackHeightMm)} m
                    </p>
                    {compact && (
                      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
                        <div>
                          <dt>{t("floors")}</dt>
                          <dd>{t("floor", { floor: floorNumber })}</dd>
                        </div>
                        <div>
                          <dt>{t("locationArea")}</dt>
                          <dd>
                            {(
                              (zone.widthMm * zone.depthMm) /
                              1_000_000
                            ).toLocaleString()}{" "}
                            m²
                          </dd>
                        </div>
                        <div>
                          <dt>{t("locationStatus")}</dt>
                          <dd>
                            {locationInventory(zone).incomplete
                              ? t("locationTable.unmeasured")
                              : locationInventory(zone).units > 0
                                ? t("locationTable.stored")
                                : t("locationTable.vacant")}
                          </dd>
                        </div>
                      </dl>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!compact && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            pendingAction !== undefined || !editable || blocked
                          }
                          onClick={() => {
                            const edit = () => startEditingStorageZone(zone);
                            if (detailsHost) detailsHost.runAction(edit);
                            else edit();
                          }}
                          aria-label={t("editStorageZone", {
                            label: zone.label,
                          })}
                          title={t("editStorageZone", { label: zone.label })}
                          className="size-11 bg-transparent p-0 hover:border-accent hover:bg-transparent disabled:bg-transparent"
                        >
                          <PencilLine className="size-3.5" />
                        </Button>
                      )}
                      {zone.mode !== "SIMPLE" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            pendingAction !== undefined || !editable || blocked
                          }
                          onClick={() => setPositionsZoneId(zone.zoneId)}
                          aria-label={t("layoutActions.positions.manageTitle", {
                            code: zone.code,
                          })}
                          title={t("layoutActions.positions.manage")}
                          className="size-11 p-0"
                        >
                          <ListTree className="size-3.5" />
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={
                          pendingAction !== undefined || !editable || blocked
                        }
                        onClick={() => requestArchive(zone)}
                        aria-label={`${t("archiveZone")} · ${zone.code}`}
                        title={`${t("archiveZone")} · ${zone.label}`}
                        className="size-11 p-0"
                      >
                        <Archive className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
            {compact && editable && (
              <details className="mb-3 text-xs text-muted">
                <summary className="flex min-h-11 cursor-pointer items-center py-2">
                  {t("canvasLocationActions")}
                </summary>
                {zone.mode !== "SIMPLE" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    disabled={pendingAction !== undefined || blocked}
                    onClick={() => setPositionsZoneId(zone.zoneId)}
                  >
                    <ListTree className="size-4" />
                    {t("layoutActions.positions.manage")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  disabled={pendingAction !== undefined || blocked}
                  onClick={() => requestArchive(zone)}
                >
                  <Archive className="size-4" />
                  {t("archiveZone")}
                </Button>
              </details>
            )}
            {zone.importNote && (
              <p className="mt-3 rounded-md border border-border bg-raised p-3 text-xs text-muted">
                {zone.importNote}
              </p>
            )}
            <details
              className="mt-3 border-t border-border pt-3"
              open={
                search.trim() && distinctPositions.length > 0 ? true : undefined
              }
            >
              <summary className="flex min-h-11 cursor-pointer items-center text-xs font-medium text-link focus-visible:outline-2 focus-visible:outline-accent">
                {t("spotLabels", { count: distinctPositions.length + 1 })}
              </summary>
              <p className="mt-2 text-xs font-medium text-text">
                {t(
                  zone.positions.length > 1
                    ? "layoutActions.qr.area"
                    : "layoutActions.qr.areaAuto",
                )}
              </p>
              {compact && (
                <LocationQrCode
                  value={zone.qrValue}
                  size={128}
                  padding={8}
                  label={t("qrForZone", { code: zone.code })}
                  className="mt-2"
                />
              )}
              <code className="mt-2 block text-xs break-all text-muted">
                {zone.qrValue}
              </code>
              <p className="mt-2 text-xs text-muted">
                {t("layoutActions.qr.help")}
              </p>
              {distinctPositions.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {distinctPositions.map((position) => (
                    <li
                      key={position.locationId}
                      className="flex items-center gap-3 rounded-lg border border-border p-2"
                    >
                      <LocationQrCode
                        value={position.qrValue}
                        size={56}
                        padding={4}
                        label={t("qrForZone", { code: position.code })}
                      />
                      <div className="min-w-0">
                        <p className="text-xs text-muted">
                          {t("layoutActions.qr.exact")}
                        </p>
                        <p className="text-sm font-medium break-words">
                          {position.label}
                        </p>
                        <p className="text-xs break-all text-muted">
                          {position.code}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </details>
            {locationInventory(zone).units === 0 &&
              !locationInventory(zone).incomplete && (
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
                  {t("noPalletsAtSpot")}
                </p>
              )}
            <LocationOnlyInventory zone={zone} />
            {zone.placements.length > 0 && (
              <details
                open={!compact || !!detailsHost?.selectedUnitId}
                className="mt-4 border-t border-border pt-3"
              >
                <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-muted">
                  {t("palletsAtLocation", {
                    count: locationInventory(zone).units,
                  })}
                </summary>
                <p className="mt-1 text-xs text-muted">
                  {t("heldFootprintArea", {
                    area: (
                      locationInventory(zone).measuredFootprintAreaSqMm /
                      1_000_000
                    ).toLocaleString(undefined, { maximumFractionDigits: 3 }),
                  })}
                </p>
                <ul className="mt-2 space-y-2">
                  {[...zone.placements]
                    .sort(
                      (a, b) =>
                        Number(b.placementId === detailsHost?.selectedUnitId) -
                        Number(a.placementId === detailsHost?.selectedUnitId),
                    )
                    .map((placement) => (
                      <li
                        key={placement.placementId}
                        className="rounded-lg border border-border p-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Link
                            href={palletPath(placement.handlingUnitId)}
                            className="min-w-0 text-sm font-semibold break-all text-link underline-offset-4 hover:underline"
                          >
                            {placement.lpn}
                          </Link>
                          <PlacementStatusBadge
                            placement={placement}
                            label={t(placementStatusKey(placement))}
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                          <div className="min-w-0">
                            {placement.positionCode && (
                              <p className="mt-1 font-mono text-xs break-all text-muted">
                                {placement.positionCode}
                              </p>
                            )}
                            {placement.xMm !== undefined &&
                              placement.yMm !== undefined && (
                                <p className="mt-1 text-xs text-muted tabular-nums">
                                  X {metres(placement.xMm)} m · Y{" "}
                                  {metres(placement.yMm)} m · Z{" "}
                                  {metres(placement.zMm ?? 0)} m
                                </p>
                              )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="size-11 bg-transparent p-0 hover:border-accent hover:bg-transparent"
                            >
                              <Link
                                href={palletPath(placement.handlingUnitId)}
                                aria-label={t("openSpotPallet", {
                                  lpn: placement.lpn,
                                })}
                                title={t("openSpotPallet", {
                                  lpn: placement.lpn,
                                })}
                              >
                                <Eye className="size-4" />
                              </Link>
                            </Button>
                            {canManage &&
                              (placement.status === "STORED" ||
                                placement.moveState !== undefined) && (
                                <Button
                                  asChild
                                  variant="outline"
                                  size="sm"
                                  className="size-11 bg-transparent p-0 hover:border-accent hover:bg-transparent"
                                >
                                  <Link
                                    href={`${palletPath(placement.handlingUnitId)}/move`}
                                    aria-label={t(
                                      placement.moveState
                                        ? "continueSpotPalletMove"
                                        : "moveSpotPallet",
                                      { lpn: placement.lpn },
                                    )}
                                    title={t(
                                      placement.moveState
                                        ? "continueSpotPalletMove"
                                        : "moveSpotPallet",
                                      { lpn: placement.lpn },
                                    )}
                                  >
                                    <ArrowRightLeft className="size-4" />
                                  </Link>
                                </Button>
                              )}
                          </div>
                        </div>
                      </li>
                    ))}
                </ul>
              </details>
            )}
            {compact && editable && (
              <div className={canvasStyles.footer}>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full whitespace-normal"
                  aria-label={t("editStorageZone", { label: zone.label })}
                  disabled={pendingAction !== undefined || blocked}
                  onClick={() => {
                    const edit = () => {
                      if (detailsHost?.editZone)
                        detailsHost.editZone(zone.zoneId);
                      else startEditingStorageZone(zone);
                    };
                    if (detailsHost) detailsHost.runAction(edit);
                    else edit();
                  }}
                >
                  <PencilLine className="size-4" />
                  {t("canvasEditLocation")}
                </Button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
  const positionsZone = zones.find((zone) => zone.zoneId === positionsZoneId);
  const lifecycleDialogs = (
    <>
      <ConfirmDialog
        open={archiving !== undefined}
        onOpenChange={(open) => {
          if (!open) setArchiving(undefined);
        }}
        title={
          archiving
            ? t("layoutActions.archiveZoneTitle", {
                code: archiving.code,
                label: archiving.label,
              })
            : ""
        }
        description={t("layoutActions.archiveZoneDescription", {
          count: archiving ? exactPositionCount(archiving) : 0,
        })}
        cancelLabel={t("cancel")}
        confirmLabel={t("layoutActions.archiveZoneConfirm")}
        pendingLabel={t("layoutActions.archivingZone")}
        tone="destructive"
        pending={pendingAction !== undefined}
        confirmDisabled={
          archiving === undefined ||
          archiving.placements.length + (archiving.unmeasuredPalletCount ?? 0) >
            0
        }
        onConfirm={() => archiving && void removeStorageZone(archiving)}
        error={
          archiveFailure === undefined
            ? undefined
            : archiveFailure.thrown
              ? t("layoutActions.failure.network")
              : storageWriteMessage(t, archiveFailure.code)
        }
      >
        {archiving &&
        archiving.placements.length + (archiving.unmeasuredPalletCount ?? 0) >
          0 ? (
          <Notice tone="warning" title={t("occupiedChangeBlocked")} />
        ) : null}
      </ConfirmDialog>
      <StoragePositionsDialog
        warehouseId={warehouseId}
        zone={positionsZone}
        onClose={() => setPositionsZoneId(undefined)}
      />
    </>
  );
  if (compact) {
    const details = (
      <>
        {visibleZones.length > 0 ? (
          <div className="min-w-0">
            {/* Inside the map workspace, the inspector or sheet already owns
                the heading and its close action; only a standalone panel
                carries its own. */}
            {!detailsHost && (
              <div className="flex items-center justify-between gap-2">
                <span className={canvasStyles.eyebrow}>
                  {t("canvasSelectedLocation")}
                </span>
                {!mobile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("mapClearSelection")}
                    title={t("mapClearSelection")}
                    onClick={onSelectionClose}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </div>
            )}
            {blocked ? (
              <Notice
                tone="accent"
                title={t("saveReservedBeforeStorage")}
                body={t("saveReservedBeforeStorageHelp")}
              />
            ) : null}
            {!editable ? (
              <Notice
                tone="muted"
                title={t(
                  canManage ? "archivedLayoutReadOnly" : "layoutViewOnly",
                )}
              />
            ) : null}
            {locationDetails}
            {message && !editorOpen ? (
              <Notice tone={message.tone} title={message.text} />
            ) : null}
          </div>
        ) : null}
      </>
    );
    return (
      <>
        {editorDialog}
        {lifecycleDialogs}
        {detailsHost
          ? detailsHost.target
            ? createPortal(details, detailsHost.target)
            : null
          : details}
      </>
    );
  }

  return (
    <section
      id="storage-stacks-section"
      tabIndex={-1}
      aria-label={t("storageZones")}
      className="min-w-0 scroll-mt-20 rounded-lg border border-border bg-surface p-4 outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-success-surface text-success">
            <QrCode className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-text">{t("storageZones")}</h2>
              <span className="rounded-md bg-background px-2 py-0.5 text-xs text-muted tabular-nums">
                {zones.length}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">{t("storageZonesHelp")}</p>
          </div>
        </div>
        {editorDialog}
        {lifecycleDialogs}
      </div>

      {blocked ? (
        <div className="mt-4">
          <Notice
            tone="accent"
            title={t("saveReservedBeforeStorage")}
            body={t("saveReservedBeforeStorageHelp")}
          />
        </div>
      ) : layoutStatus === "ACTIVE" && editable ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted">
          <Zap className="size-4 shrink-0 text-success" aria-hidden="true" />
          <span>{t("quickChangeActive")}</span>
          <StatusReason
            label={t("quickChangeActive")}
            message={t("quickChangeActiveHelp")}
          />
        </div>
      ) : !editable ? (
        <div className="mt-4">
          <Notice
            tone="muted"
            title={t(canManage ? "archivedLayoutReadOnly" : "layoutViewOnly")}
          />
        </div>
      ) : null}

      {!compact ? (
        <>
          <div className="relative mt-4">
            <Label htmlFor={searchId} className="sr-only">
              {t("searchStorageSpots")}
            </Label>
            <Search
              className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              placeholder={t("searchStorageSpotsPlaceholder")}
              className="pr-11 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute top-0 right-0 size-11 p-0"
                aria-label={t("clearSpotSearch")}
                onClick={() => {
                  setSearch("");
                  document.getElementById(searchId)?.focus();
                }}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          <p role="status" className="mt-2 text-xs text-muted">
            {t("spotSearchCount", {
              count: visibleZones.length,
              total: zones.length,
            })}
          </p>
        </>
      ) : null}
      {visibleZones.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <Search
            className="mx-auto mb-2 size-5 text-muted"
            aria-hidden="true"
          />
          <p className="font-medium">
            {t(
              compact && zones.length
                ? "mapChoose"
                : zones.length
                  ? "noMatchingSpots"
                  : "noStorageSpots",
            )}
          </p>
          <p className="mt-1 text-sm text-muted">
            {t(
              compact && zones.length
                ? "mapInspectHint"
                : zones.length
                  ? "noMatchingSpotsHelp"
                  : "noStorageSpotsHelp",
            )}
          </p>
          {search && (
            <Button
              type="button"
              variant="ghost"
              className="mt-2"
              onClick={() => setSearch("")}
            >
              {t("clearSpotSearch")}
            </Button>
          )}
        </div>
      )}
      {locationDetails}

      {message === undefined || editorOpen ? null : (
        <div className="mt-4">
          <Notice tone={message.tone} title={message.text} />
        </div>
      )}
    </section>
  );
}

function LocationOnlyInventory({ zone }: { zone: StorageZoneRow }) {
  const th = useLocale() === "th";
  if (!zone.locationOnlyPlacements?.length) return null;
  return (
    <div className="mt-4 space-y-2 border-t border-border pt-3">
      <p className="text-sm font-semibold">
        {th ? "สินค้าที่บันทึกเฉพาะจุดจัดเก็บ" : "Units with a saved location"}{" "}
        · {zone.locationOnlyPlacements.length}
      </p>
      <p className="text-xs text-muted">
        {th
          ? "ไม่ได้วัดพิกัด พื้นที่ว่างคงเหลือไม่ทราบแน่ชัด"
          : "Coordinates unmeasured. Remaining floor space is unknown."}
      </p>
      <ul className="space-y-2">
        {zone.locationOnlyPlacements.map((unit) => (
          <li
            key={unit.placementId}
            className="rounded-lg border border-border p-3 text-sm"
          >
            <Link
              className="font-semibold text-link underline"
              href={palletPath(unit.handlingUnitId)}
            >
              {unit.lpn}
            </Link>{" "}
            · #{unit.sequence} · {unit.productName}
          </li>
        ))}
      </ul>
    </div>
  );
}
