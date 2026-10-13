"use client";

import { useMutation, useQuery } from "convex/react";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import AnimatedToggle from "@/components/ui/animated-toggle";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StatusReason } from "@/components/ui/StatusReason";
import { storageWriteMessage } from "./layoutActions";
import { storageReviewPath } from "@/lib/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Link } from "@/i18n/navigation";
import { Notice } from "@/components/ui/Notice";
import {
  storageLayoutRefs,
  type StorageLayoutStatus,
  type BuildingLifecycleImpact,
} from "@/lib/convex/storageLayoutApi";

const setupErrors = new Set([
  "STORAGE_STACK_REQUIRED",
  "RESERVED_BLOCK_COLOR_INVALID",
  "FLOOR_COUNT_INVALID",
  "FLOOR_SEQUENCE_INVALID",
  "DIMENSION_INVALID",
  "FLOOR_PLACEMENT_INVALID",
  "FLOOR_OUT_OF_BOUNDS",
  "RESERVED_BLOCK_COUNT_INVALID",
  "RESERVED_BLOCK_INVALID",
  "RESERVED_BLOCK_OUT_OF_BOUNDS",
  "RESERVED_BLOCKS_OVERLAP",
  "ZONE_DIMENSION_INVALID",
  "ZONE_OUT_OF_BOUNDS",
  "ZONE_OVERLAPS_RESERVED_SPACE",
  "ZONE_OVERLAPS_STORAGE_ZONE",
  "HANDLING_UNIT_DOES_NOT_FIT",
  "STACK_SEQUENCE_INVALID",
]);

export function BuildingStatusToggle({
  warehouseId,
  buildingId,
  code,
  status,
  sharedControl,
}: {
  readonly warehouseId: string;
  readonly buildingId: string;
  readonly code: string;
  readonly status: StorageLayoutStatus;
  readonly sharedControl?: {
    readonly loaded: boolean;
    readonly value:
      | { status: StorageLayoutStatus; version: number; blocked: boolean }
      | null
      | undefined;
  };
}) {
  const t = useTranslations("StorageLayouts");
  const workspace = useWorkspace();
  const canChange =
    workspace.permissionsReady &&
    workspace.navigationPermissions.includes(
      "masterData.storageLayout.activate",
    );
  const result = useQuery(
    storageLayoutRefs.statusControl,
    !sharedControl && canChange && status !== "ARCHIVED"
      ? { warehouseId, buildingId }
      : "skip",
  );
  // The switch changes the whole building, so it always confirms with the
  // building name and how many addresses change (F14). Activation also shows
  // the server preflight before the command is offered (F15).
  const [confirming, setConfirming] = useState(false);
  const impact = useQuery(
    storageLayoutRefs.lifecycleImpact,
    confirming ? { warehouseId, buildingId } : "skip",
  );
  const readiness = useQuery(
    storageLayoutRefs.readiness,
    confirming && status !== "ACTIVE" ? { warehouseId, buildingId } : "skip",
  );
  const activate = useMutation(storageLayoutRefs.activate);
  const returnToDraft = useMutation(storageLayoutRefs.returnToDraft);
  const operation = useAsyncOperation({
    scope: `storage-status:${warehouseId}:${buildingId}`,
    describeError: (code) => code || "NETWORK_ERROR",
  });
  const [error, setError] = useState<{
    code: string;
    buildingId: string;
    warehouseId: string;
    version: number;
    status: StorageLayoutStatus;
    denied: boolean;
  }>();
  const control = sharedControl
    ? sharedControl.value
    : result?.ok
      ? result.value
      : undefined;
  const current = control?.status ?? status;
  const active = current === "ACTIVE";
  const label = t(
    current === "ARCHIVED" ? "archived" : active ? "active" : "draft",
  );

  async function change() {
    if (
      !control ||
      control.blocked ||
      operation.busy ||
      (impact?.ok &&
        (impact.value.capacityExceeded === true ||
          impact.value.canArchive === false))
    )
      return;
    setError(undefined);
    const version = control.version;
    const status = current;
    const requestKey = `${active ? "draft" : "activate"}:${version}`;
    await operation.run(
      async () => {
        try {
          const outcome = await (active ? returnToDraft : activate)({
            warehouseId,
            buildingId,
            expectedVersion: version,
            requestId: operation.request(requestKey),
          });
          return { kind: "settled", outcome } as const;
        } catch {
          return { kind: "network" } as const;
        }
      },
      (result) => {
        // The outcome is reported beside the switch, which stays the owner.
        setConfirming(false);
        if (result.kind === "network") {
          setError({
            buildingId,
            warehouseId,
            code: "NETWORK_ERROR",
            version,
            status,
            denied: false,
          });
          return;
        }
        const outcome = result.outcome;
        if (!outcome.ok) {
          setError({
            buildingId,
            warehouseId,
            code: outcome.denial.code,
            version,
            status,
            denied: true,
          });
        } else if (!outcome.value.written) {
          setError({
            buildingId,
            warehouseId,
            code: outcome.value.error.code,
            version,
            status,
            denied: false,
          });
        } else {
          operation.clearRequests();
        }
      },
    );
  }

  if (!canChange || current === "ARCHIVED")
    return (
      <StatusBadge
        tone={active ? "success" : current === "DRAFT" ? "pending" : "muted"}
        label={label}
      />
    );
  // A newer authoritative status makes the previous attempt's error obsolete.
  const failure =
    error?.buildingId === buildingId &&
    error?.warehouseId === warehouseId &&
    error?.version === control?.version &&
    error?.status === current
      ? error
      : undefined;
  const setupFailure =
    failure && !failure.denied && !active && setupErrors.has(failure.code);
  const message =
    failure?.code === "LAYOUT_CAPACITY_LIMIT"
      ? storageWriteMessage(t, failure.code)
      : failure
        ? t(
            failure.denied
              ? "statusAccessError"
              : failure.code === "LOCATION_OCCUPIED"
                ? "statusOccupied"
                : failure.code === "VERSION_CONFLICT"
                  ? "layoutChangedRetry"
                  : failure.code === "NETWORK_ERROR"
                    ? "statusNetworkError"
                    : setupFailure
                      ? "statusSetupError"
                      : "statusChangeFailed",
          )
        : control?.blocked
          ? t("statusOccupied")
          : (sharedControl ? sharedControl.loaded : result !== undefined) &&
              !control
            ? t("statusUnavailable")
            : undefined;
  return (
    <div
      className="relative z-10 flex min-h-touch items-center gap-2"
      aria-busy={operation.busy}
    >
      <AnimatedToggle
        checked={active}
        onChange={() => setConfirming(true)}
        disabled={operation.busy || !control || control.blocked}
        label={t("statusToggleLabel", { code })}
        size="md"
      />
      <span className="text-xs font-medium">{label}</span>
      <span className="flex size-12 shrink-0 items-center justify-center">
        {operation.busy || result === undefined ? (
          <span role="status">
            <LoaderCircle
              className="size-4 animate-spin text-muted"
              aria-hidden="true"
            />
            <span className="sr-only">
              {t(operation.busy ? "statusSaving" : "statusLoading")}
            </span>
          </span>
        ) : message ? (
          <StatusReason
            key={failure ? `error-${failure.code}` : "blocked"}
            label={
              setupFailure
                ? `${t("statusReviewSetup")} · ${code}`
                : t(failure ? "statusErrorLabel" : "statusReasonLabel", {
                    code,
                  })
            }
            message={message}
            tone={failure || !control ? "error" : "locked"}
            href={setupFailure ? storageReviewPath(buildingId) : undefined}
            announce={!!failure}
          />
        ) : null}
      </span>
      <StatusConfirmation
        open={confirming}
        onOpenChange={setConfirming}
        active={active}
        code={code}
        buildingId={buildingId}
        pending={operation.busy}
        onConfirm={() => void change()}
        impact={impact?.ok ? impact.value : undefined}
        impactLoading={confirming && impact === undefined}
        ready={
          active
            ? true
            : readiness?.ok
              ? readiness.value.found === true &&
                readiness.value.ready === true &&
                readiness.value.version === control?.version
              : undefined
        }
      />
    </div>
  );
}

function StatusConfirmation({
  open,
  onOpenChange,
  active,
  code,
  buildingId,
  pending,
  onConfirm,
  impact,
  impactLoading,
  ready,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly active: boolean;
  readonly code: string;
  readonly buildingId: string;
  readonly pending: boolean;
  readonly onConfirm: () => void;
  readonly impact: BuildingLifecycleImpact | undefined;
  readonly impactLoading: boolean;
  readonly ready: boolean | undefined;
}) {
  const t = useTranslations("StorageLayouts");
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(
        active
          ? "layoutActions.statusConfirmDraftTitle"
          : "layoutActions.statusConfirmActivateTitle",
        { code },
      )}
      description={t(
        active
          ? "layoutActions.statusConfirmDraftDescription"
          : "layoutActions.statusConfirmActivateDescription",
      )}
      cancelLabel={t("cancel")}
      confirmLabel={t(
        active
          ? "layoutActions.statusConfirmDraft"
          : "layoutActions.statusConfirmActivate",
      )}
      pendingLabel={t("statusSaving")}
      pending={pending}
      confirmDisabled={
        !impact?.found ||
        ready !== true ||
        impact.capacityExceeded === true ||
        impact.canArchive === false
      }
      onConfirm={onConfirm}
    >
      {impactLoading ? (
        <p role="status" className="text-sm text-muted">
          {t("layoutActions.impactLoading")}
        </p>
      ) : impact?.found ? (
        <p className="text-sm font-medium" data-testid="status-impact">
          {impact.complete === false ||
          impact.namedRegistrationCountComplete === false ? (
            <span className="mb-1 block font-normal text-muted">
              {t("layoutActions.impactCountsMinimum")}
            </span>
          ) : null}
          {t("layoutActions.impactCounts", {
            zones: impact.zoneCount ?? 0,
            positions: impact.positionCount ?? 0,
            named: impact.namedRegistrationCount ?? 0,
          })}
        </p>
      ) : null}
      {impact?.capacityExceeded ? (
        <Notice
          tone="warning"
          title={storageWriteMessage(t, "LAYOUT_CAPACITY_LIMIT")}
        />
      ) : null}
      {!active && ready === undefined ? (
        <p role="status" className="text-sm text-muted">
          {t("layoutActions.readinessChecking")}
        </p>
      ) : !active && ready === false ? (
        <Notice tone="warning" title={t("layoutActions.statusNotReady")}>
          <Link
            href={storageReviewPath(buildingId)}
            className="mt-2 inline-flex min-h-11 items-center text-sm text-link underline-offset-4 hover:underline"
          >
            {t("review")}
          </Link>
        </Notice>
      ) : null}
    </ConfirmDialog>
  );
}
