"use client";
import { updateBrowserQuery } from "@/lib/browser/history";
import { useWorkspaceQuery, workspaceStateEvent } from "./useWorkspaceQuery";

import { StorageZoneDraftPreview } from "@/components/storageLayouts/StorageZoneDraftPreview";

import { rectanglesOverlap } from "@/lib/storageLayouts/storagePlacementGeometry";
import { storageRectangleContains } from "../../../convex/model/storageLayout/storageZone";

import { useMutation } from "convex/react";
import {
  Archive,
  ArrowRightLeft,
  CheckCircle2,
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

import {
  ChangeImpactSummary,
  metres,
  millimetres,
  storageErrorMessage,
} from "./storageLayoutShared";
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
  });
  const [label, setLabel] = useState("");
  const [storageCondition, setStorageCondition] = useState("ANY");
  const [zoneX, setZoneX] = useState("0");
  const [zoneY, setZoneY] = useState("0");
  const [zoneWidth, setZoneWidth] = useState("2");
  const [zoneDepth, setZoneDepth] = useState("2");
  const [stackHeight, setStackHeight] = useState(String(metres(floorHeightMm)));
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  useLayoutEffect(() => {
    onEditorOpenChange?.(createDialogOpen && editable);
    return () => onEditorOpenChange?.(false);
  }, [createDialogOpen, editable, onEditorOpenChange]);
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
  const [confirmingImpact, setConfirmingImpact] = useState(false);
  const [pendingAction, setPendingAction] = useState<string>();
  useLayoutEffect(() => {
    onSavingChange?.(pendingAction !== undefined);
    return () => onSavingChange?.(false);
  }, [pendingAction, onSavingChange]);
  const [message, setMessage] = useState<{
    readonly tone: "success" | "warning";
    readonly text: string;
  }>();
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
      setConfirmingImpact(false);
      setEditingZone(zone);
      setLabel(zone.label);
      setStorageCondition(zone.storageCondition?.trim().toUpperCase() || "ANY");
      setZoneX(String(metres(zone.xMm)));
      setZoneY(String(metres(zone.yMm)));
      setZoneWidth(String(metres(zone.widthMm)));
      setZoneDepth(String(metres(zone.depthMm)));
      setStackHeight(String(metres(zone.maxStackHeightMm)));
      setCreateDialogOpen(true);
    }
  }, [editable, zones, editRequest, zoneQuery]);
  const zoneDraft = {
    xMm: millimetres(zoneX),
    yMm: millimetres(zoneY),
    widthMm: millimetres(zoneWidth),
    depthMm: millimetres(zoneDepth),
  };
  const normalizedCondition = (condition: string | undefined) => {
    const normalized = condition?.trim().toUpperCase();
    return normalized === "ANY" ? "" : (normalized ?? "");
  };
  const occupiedChangeBlocked =
    editingZone !== undefined &&
    editingZone.placements.length + (editingZone.unmeasuredPalletCount ?? 0) >
      0 &&
    (zoneDraft.xMm !== editingZone.xMm ||
      zoneDraft.yMm !== editingZone.yMm ||
      zoneDraft.widthMm !== editingZone.widthMm ||
      zoneDraft.depthMm !== editingZone.depthMm ||
      millimetres(stackHeight) !== editingZone.maxStackHeightMm ||
      normalizedCondition(storageCondition) !==
        normalizedCondition(editingZone.storageCondition));
  const otherZones =
    editingZone === undefined
      ? zones
      : zones.filter((zone) => zone.zoneId !== editingZone.zoneId);
  const storageDraftValid =
    zoneDraft.xMm >= 0 &&
    zoneDraft.yMm >= 0 &&
    zoneDraft.widthMm > 0 &&
    zoneDraft.depthMm > 0 &&
    millimetres(stackHeight) > 0 &&
    zoneDraft.xMm + zoneDraft.widthMm <= floorWidthMm &&
    zoneDraft.yMm + zoneDraft.depthMm <= floorDepthMm &&
    millimetres(stackHeight) <= floorHeightMm &&
    !reservedBlocks.some(
      (area) =>
        rectanglesOverlap(zoneDraft, area) &&
        !storageRectangleContains(zoneDraft, area),
    ) &&
    !otherZones.some((area) => rectanglesOverlap(zoneDraft, area));

  const startNewStorageZone = () => {
    if (!editable || blocked) return;
    const position = firstFreeStoragePosition(
      floorWidthMm,
      floorDepthMm,
      2_000,
      2_000,
      [...reservedBlocks, ...zones],
    );
    setEditingZone(undefined);
    setLabel("");
    setStorageCondition("ANY");
    setZoneX(String(metres(position.xMm)));
    setZoneY(String(metres(position.yMm)));
    setZoneWidth("2");
    setZoneDepth("2");
    setStackHeight(String(metres(floorHeightMm)));
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
    setEditingZone(zone);
    setLabel(zone.label);
    setStorageCondition(zone.storageCondition?.trim().toUpperCase() || "ANY");
    setZoneX(String(metres(zone.xMm)));
    setZoneY(String(metres(zone.yMm)));
    setZoneWidth(String(metres(zone.widthMm)));
    setZoneDepth(String(metres(zone.depthMm)));
    setStackHeight(String(metres(zone.maxStackHeightMm)));
    setConfirmingImpact(false);
    setMessage(undefined);
    setCreateDialogOpen(true);
  };

  const saveStorageZone = async () => {
    if (!editable || blocked) return;
    if (occupiedChangeBlocked) {
      setConfirmingImpact(true);
      return;
    }
    const isEditing = editingZone !== undefined;
    setPendingAction(isEditing ? "update" : "create");
    setMessage(undefined);
    try {
      const draft = {
        warehouseId,
        label: label || t("newStorageZoneLabel", { number: zones.length + 1 }),
        xMm: millimetres(zoneX),
        yMm: millimetres(zoneY),
        widthMm: millimetres(zoneWidth),
        depthMm: millimetres(zoneDepth),
        maxStackHeightMm: millimetres(stackHeight),
        storageCondition: storageCondition === "ANY" ? "" : storageCondition,
      };
      const outcome = isEditing
        ? await operation.run(() => {
            const payload = {
              ...draft,
              zoneId: editingZone.zoneId,
              ...(confirmingImpact ? { confirmOccupiedChange: true } : {}),
            };
            return updateZone({
              ...payload,
              requestId: operation.request(JSON.stringify(payload)),
            });
          })
        : await operation.run(() => {
            const payload = { ...draft, buildingId, floorNumber };
            return createZone({
              ...payload,
              requestId: operation.request(JSON.stringify(payload)),
            });
          });
      if (!outcome) return;
      if (!outcome.ok) {
        setMessage({
          tone: "warning",
          text: storageErrorMessage(t, outcome.denial.code),
        });
      } else if (!outcome.value.written) {
        setMessage({
          tone: "warning",
          text: storageErrorMessage(t, outcome.value.error.code),
        });
      } else {
        operation.clearRequests();
        setLabel("");
        setConfirmingImpact(false);
        setCreateDialogOpen(false);
        setEditingZone(undefined);
        setMessage({
          tone: "success",
          text: t(isEditing ? "storageZoneUpdated" : "storageZoneCreated"),
        });
      }
    } finally {
      setPendingAction(undefined);
    }
  };

  const removeStorageZone = async (zone: StorageZoneRow) => {
    if (!editable || blocked) return;
    setPendingAction(zone.zoneId);
    setMessage(undefined);
    try {
      const payload = {
        warehouseId,
        zoneId: zone.zoneId,
      };
      const outcome = await operation.run(() =>
        archiveZone({
          ...payload,
          requestId: operation.request(JSON.stringify(payload)),
        }),
      );
      if (!outcome) return;
      if (!outcome.ok) {
        const code = outcome.denial.code;
        setMessage({ tone: "warning", text: storageErrorMessage(t, code) });
      } else if (!outcome.value.written) {
        const code = outcome.value.error.code;
        setMessage({ tone: "warning", text: storageErrorMessage(t, code) });
      } else {
        operation.clearRequests();
        setMessage({ tone: "success", text: t("storageZoneArchived") });
      }
    } finally {
      setPendingAction(undefined);
    }
  };

  const editorDialog = (
    <Dialog
      open={createDialogOpen && editable}
      onOpenChange={(open) => {
        if (open && !editable) return;
        setCreateDialogOpen(open);
        if (open) setMessage(undefined);
        else {
          clearZoneIntent();
          setEditingZone(undefined);
          setConfirmingImpact(false);
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
            {[
              ["x", zoneX, setZoneX, 0, floorWidthMm],
              ["y", zoneY, setZoneY, 0, floorDepthMm],
              ["zoneWidth", zoneWidth, setZoneWidth, 0.1, floorWidthMm],
              ["zoneDepth", zoneDepth, setZoneDepth, 0.1, floorDepthMm],
            ].map(([key, value, setValue, min, max]) => (
              <div key={String(key)}>
                <Label htmlFor={`new-storage-zone-${String(key)}`}>
                  {t(key as "x" | "y" | "zoneWidth" | "zoneDepth")}
                </Label>
                <Input
                  id={`new-storage-zone-${String(key)}`}
                  className="mt-2"
                  type="number"
                  min={Number(min)}
                  max={metres(Number(max))}
                  step="0.1"
                  value={String(value)}
                  onChange={(event) =>
                    (setValue as (value: string) => void)(event.target.value)
                  }
                />
              </div>
            ))}
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
              <Input
                id="new-storage-zone-height"
                className="mt-2"
                type="number"
                min="0.1"
                max={metres(floorHeightMm)}
                step="0.1"
                value={stackHeight}
                onChange={(event) => setStackHeight(event.target.value)}
              />
            </div>
          </div>
        </div>
        {message === undefined ? null : (
          <Notice tone={message.tone} title={message.text} />
        )}
        {confirmingImpact && editingZone !== undefined ? (
          <ChangeImpactSummary
            placements={editingZone.placements}
            currentPlan={`${metres(editingZone.widthMm)} × ${metres(editingZone.depthMm)} × ${metres(editingZone.maxStackHeightMm)} m`}
            proposedPlan={`${metres(zoneDraft.widthMm)} × ${metres(zoneDraft.depthMm)} × ${metres(millimetres(stackHeight))} m`}
          />
        ) : null}
        <DialogFooter>
          {confirmingImpact ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmingImpact(false)}
            >
              {t("backToEdit")}
            </Button>
          ) : (
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
          )}
          <Button
            type="button"
            onClick={() => {
              if (occupiedChangeBlocked) {
                setConfirmingImpact(true);
                return;
              }
              void saveStorageZone();
            }}
            disabled={
              pendingAction !== undefined ||
              !editable ||
              blocked ||
              !storageDraftValid ||
              (confirmingImpact && occupiedChangeBlocked)
            }
          >
            {editingZone === undefined ? (
              <Plus className="size-4" />
            ) : confirmingImpact ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <PencilLine className="size-4" />
            )}
            {pendingAction === "create"
              ? t("creating")
              : pendingAction === "update"
                ? t("updating")
                : confirmingImpact
                  ? t("confirmChanges")
                  : occupiedChangeBlocked
                    ? t("reviewImpact")
                    : t(
                        editingZone === undefined
                          ? "createStorageZone"
                          : "saveStorageZoneChanges",
                      )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  const locationDetails = (
    <div
      className={
        compact
          ? "mt-4 min-w-0"
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
            className="min-w-0 scroll-mt-20 rounded-xl border border-border bg-background p-4 outline-none target:border-accent target:ring-1 target:ring-accent focus-visible:ring-2 focus-visible:ring-accent"
          >
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
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      pendingAction !== undefined || !editable || blocked
                    }
                    onClick={() => startEditingStorageZone(zone)}
                    aria-label={t("editStorageZone", { label: zone.label })}
                    title={t("editStorageZone", { label: zone.label })}
                    className="size-10 bg-transparent p-0 hover:border-accent hover:bg-transparent disabled:bg-transparent"
                  >
                    <PencilLine className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={
                      pendingAction !== undefined || !editable || blocked
                    }
                    onClick={() => removeStorageZone(zone)}
                    aria-label={t("archiveZone")}
                    title={`${t("archiveZone")} · ${zone.label}`}
                    className="size-10 p-0"
                  >
                    <Archive className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
            <details
              className="mt-3 border-t border-border pt-3"
              open={
                search.trim() && distinctPositions.length > 0 ? true : undefined
              }
            >
              <summary className="cursor-pointer text-xs font-medium text-link focus-visible:outline-2 focus-visible:outline-accent">
                {t("spotLabels", { count: distinctPositions.length + 1 })}
              </summary>
              <code className="mt-2 block text-xs break-all text-muted">
                {zone.qrValue}
              </code>
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
              <details open className="mt-4 border-t border-border pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-muted">
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
                  {zone.placements.map((placement) => (
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
                            className="size-10 bg-transparent p-0 hover:border-accent hover:bg-transparent"
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
                                className="size-10 bg-transparent p-0 hover:border-accent hover:bg-transparent"
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
          </article>
        );
      })}
    </div>
  );
  if (compact)
    return (
      <>
        {editorDialog}
        {visibleZones.length > 0 ? (
          <div className="min-w-0">
            <div className="flex justify-end">
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
            </div>
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
            {message && !createDialogOpen ? (
              <Notice tone={message.tone} title={message.text} />
            ) : null}
          </div>
        ) : null}
      </>
    );

  return (
    <section
      id="storage-stacks-section"
      tabIndex={-1}
      aria-label={t("storageZones")}
      className="min-w-0 scroll-mt-20 rounded-2xl border border-border bg-surface p-5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

      {message === undefined || createDialogOpen ? null : (
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

const firstFreeStoragePosition = (
  floorWidthMm: number,
  floorDepthMm: number,
  widthMm: number,
  depthMm: number,
  areas: readonly {
    readonly xMm: number;
    readonly yMm: number;
    readonly widthMm: number;
    readonly depthMm: number;
  }[],
) => {
  const stepMm = 500;
  for (let yMm = 0; yMm + depthMm <= floorDepthMm; yMm += stepMm) {
    for (let xMm = 0; xMm + widthMm <= floorWidthMm; xMm += stepMm) {
      const candidate = { xMm, yMm, widthMm, depthMm };
      if (!areas.some((area) => rectanglesOverlap(candidate, area))) {
        return { xMm, yMm };
      }
    }
  }
  return { xMm: 0, yMm: 0 };
};
