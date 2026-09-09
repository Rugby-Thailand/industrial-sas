"use client";
import { useMutation } from "convex/react";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { Link, useRouter } from "@/i18n/navigation";
import {
  fgRefs,
  type Candidate,
  type Destination,
  type PalletDetail,
} from "@/lib/convex/finishedGoodsApi";
import { PalletScene, type PalletPlacement } from "./PalletScene";
import {
  palletPlacementIssue,
  resolvePalletSupport,
  type PlacementSurface,
} from "./palletGeometry";
import { destinationKey } from "./DestinationPicker";
import { usePreviewState } from "./usePreviewState";
import {
  ErrorNotice,
  errorText,
  Field,
  mmText,
  palletPath,
  panel,
  useFGText,
  useUnitText,
  useDraftKey,
  useOperation,
  written,
  unitCorrectionPath,
  measurePath,
} from "./shared";

export function correctionPath(detail: PalletDetail) {
  return detail.pallet.preparationBatchId
    ? unitCorrectionPath(detail.pallet.productId, detail.pallet._id)
    : measurePath(detail.pallet._id);
}

export function sceneProps(
  destination: Candidate | Destination,
  detail: PalletDetail,
) {
  return {
    storageFormat: detail.pallet.storageFormat ?? detail.product?.storageFormat,
    dimensions: {
      widthMm: detail.pallet.widthMm ?? 0,
      depthMm: detail.pallet.lengthMm ?? 0,
      heightMm: detail.pallet.heightMm ?? 0,
    },
    area: {
      widthMm: destination.zone.widthMm,
      depthMm: destination.zone.depthMm,
      heightMm:
        destination.zone.maxStackHeightMm + destination.zone.baseElevationMm,
    },
    support: destination.support,
    unavailable: destination.unavailable,
    occupied: destination.occupied
      .filter((p) => p.palletId !== detail.pallet._id)
      .map((p) => ({ ...p, id: p.placementId, label: p.positionCode })),
  };
}
export function DestinationSummary({
  destination,
  placement,
}: {
  destination: Candidate | Destination;
  placement: PalletPlacement;
}) {
  const { tr } = useFGText();
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xl font-semibold break-words">
          {destination.locationName}
        </p>
        <p className="text-sm text-muted">
          {destination.buildingCode} · {tr("Floor", "ชั้น")}{" "}
          {destination.floorNumber}
        </p>
        {destination.supportLabel || destination.supportCode ? (
          <p className="text-sm">
            {tr("Support", "ฐานรองรับ")}:{" "}
            {destination.supportLabel ?? destination.supportCode}
          </p>
        ) : null}
        <p className="font-mono text-sm break-all">
          {destination.positionCode === "Proposed"
            ? tr("Proposed position", "ตำแหน่งที่เสนอ")
            : destination.positionCode}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {[
          ["X", mmText(placement.xMm)],
          ["Y", mmText(placement.yMm)],
          [
            tr("Base elevation", "ระดับฐาน"),
            mmText(placement.zMm ?? destination.support.zMm),
          ],
          [tr("Orientation", "ทิศทาง"), `${placement.rotation}°`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1 font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      <details className="text-sm text-muted">
        <summary className="w-fit cursor-pointer">
          {tr("Coordinate guide", "วิธีอ่านพิกัด")}
        </summary>
        <p className="mt-2">
          {tr(
            "X/Y start at the marked origin in the plan.",
            "X/Y วัดจากจุดเริ่มต้นในแผนผัง",
          )}
        </p>
      </details>
    </div>
  );
}
export function PlacementEditor({
  warehouseId,
  detail,
  candidate: initialCandidate,
  destinations = [initialCandidate],
  moving = false,
  onReserved,
  onActivate,
}: {
  warehouseId: string;
  detail: PalletDetail;
  candidate: Candidate;
  destinations?: readonly Candidate[];
  moving?: boolean;
  onReserved?: () => void;
  onActivate?: () => void;
}) {
  const { tr, locale } = useUnitText(
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const router = useRouter();
  const mutate = useMutation(fgRefs.reserve);
  const moveMutation = useMutation(fgRefs.reserveMove);
  const actorScope = useDraftKey("fg-move-reserve");
  const op = useOperation(
    moving ? `${actorScope}:${warehouseId}:${detail.pallet._id}` : undefined,
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const previewKey = actorScope
    ? `${actorScope}:${warehouseId}:${detail.pallet._id}:${moving ? "move" : "store"}:${destinationKey(initialCandidate)}`
    : undefined;
  const [draft, setDraft, clearDraft] = usePreviewState(previewKey, {
    x: String(initialCandidate.xMm / 1000),
    y: String(initialCandidate.yMm / 1000),
    rotation: initialCandidate.rotation as number,
    reason: "",
  });
  const reason = draft.reason;
  const setReason = (reason: string) =>
    setDraft((previous) => ({ ...previous, reason }));
  const coordinateDraft = { x: draft.x, y: draft.y };
  const requested: PalletPlacement = {
    xMm: Number.isFinite(Number(draft.x))
      ? Math.round(Number(draft.x) * 1000)
      : initialCandidate.xMm,
    yMm: Number.isFinite(Number(draft.y))
      ? Math.round(Number(draft.y) * 1000)
      : initialCandidate.yMm,
    zMm: initialCandidate.zMm,
    rotation: draft.rotation === 90 ? 90 : 0,
  };
  const coordinateInvalid = Object.values(coordinateDraft).some(
    (value) =>
      value.trim() === "" ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0,
  );
  const coordinateMessage = tr(
    "Enter valid X and Y coordinates, zero or greater.",
    "กรอกพิกัด X และ Y ให้ถูกต้อง ตั้งแต่ศูนย์ขึ้นไป",
  );
  function updatePlacement(next: PalletPlacement) {
    onActivate?.();
    setDraft((previous) => ({
      ...previous,
      x: String(next.xMm / 1000),
      y: String(next.yMm / 1000),
      rotation: next.rotation,
    }));
  }
  function updateCoordinate(axis: "x" | "y", value: string) {
    onActivate?.();
    setDraft((previous) => ({ ...previous, [axis]: value }));
  }
  const initialProps = sceneProps(initialCandidate, detail);
  const allSurfaces: PlacementSurface[] = initialCandidate.previewSupports
    ? initialCandidate.previewSupports.map(({ surface, ...metadata }) => ({
        ...surface,
        ...metadata,
      }))
    : destinations
        .filter((d) => d.zoneId === initialCandidate.zoneId)
        .map((d) => ({
          ...d.support,
          supportPalletId: d.supportPalletId,
          supportPositionId: d.supportPositionId,
          supportCode: d.supportCode,
        }));
  const allowsPalletStacking =
    (detail.pallet.storageFormat ?? detail.product?.storageFormat) === "PALLET";
  const surfaces = allSurfaces.filter(
    (s) => !s.supportPalletId || allowsPalletStacking,
  );
  const selectedSurface = surfaces.find(
    (s) =>
      s.supportPalletId === initialCandidate.supportPalletId &&
      s.supportPositionId === initialCandidate.supportPositionId,
  );
  const base = surfaces.find(
    (s) =>
      !s.supportPalletId &&
      s.supportPositionId ===
        (selectedSurface?.baseSupportPositionId ??
          initialCandidate.supportPositionId),
  ) ?? {
    ...initialCandidate.support,
    supportPositionId: initialCandidate.supportPositionId,
  };
  const resolved = resolvePalletSupport(
    requested,
    initialProps.dimensions,
    base,
    surfaces,
  );
  const placement = { ...requested, zMm: resolved.zMm };
  const candidate: { -readonly [K in keyof Candidate]: Candidate[K] } = {
    ...initialCandidate,
    support: resolved,
    ...placement,
  };
  delete candidate.supportPalletId;
  delete candidate.supportPositionId;
  delete candidate.supportCode;
  delete candidate.supportLabel;
  if (resolved.supportPalletId)
    candidate.supportPalletId = resolved.supportPalletId;
  if (resolved.supportPositionId)
    candidate.supportPositionId = resolved.supportPositionId;
  if (resolved.supportCode)
    candidate.supportCode = candidate.supportLabel = resolved.supportCode;
  const props = sceneProps(candidate, detail);
  const unchanged =
    moving &&
    detail.placement?.zoneId === candidate.zoneId &&
    detail.placement?.supportPositionId === candidate.supportPositionId &&
    detail.placement?.supportPalletId === candidate.supportPalletId &&
    detail.placement?.xMm === placement.xMm &&
    detail.placement?.yMm === placement.yMm &&
    detail.placement?.zMm === placement.zMm &&
    detail.placement?.rotation === placement.rotation;
  const issue =
    (coordinateInvalid ? "boundary" : undefined) ??
    resolved.blockedReason ??
    palletPlacementIssue(
      props.dimensions,
      props.area,
      placement,
      props.occupied,
      props.support,
      props.unavailable,
    );
  async function reserve() {
    await op.run(async () => {
      if (issue || unchanged) throw new Error("SPACE_UNAVAILABLE");
      const args = {
        warehouseId,
        palletId: detail.pallet._id,
        zoneId: candidate.zoneId,
        ...(candidate.supportPositionId
          ? { supportPositionId: candidate.supportPositionId }
          : {}),
        ...(candidate.supportPalletId
          ? { supportPalletId: candidate.supportPalletId }
          : {}),
        xMm: placement.xMm,
        yMm: placement.yMm,
        rotation: placement.rotation,
        expectedMeasurementUpdatedAt: detail.pallet.updatedAt,
      };
      if (moving) {
        if (!detail.placement) throw new Error("LOCATION_UNAVAILABLE");
        const moveArgs = {
          ...args,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          expectedSourcePlacementId: detail.placement._id,
          ...(detail.activeMove ? { moveId: detail.activeMove._id } : {}),
        };
        written(
          await moveMutation({
            ...moveArgs,
            requestId: op.request(JSON.stringify(moveArgs)),
          }),
        );
      } else {
        written(
          await mutate({
            ...args,
            requestId: op.request(JSON.stringify(args)),
          }),
        );
      }
      op.clearRequests();
      clearDraft();
      onReserved?.();
      router.push(
        moving
          ? `${palletPath(detail.pallet._id)}/move`
          : palletPath(detail.pallet._id),
      );
    });
  }
  return (
    <div className="space-y-4">
      <ErrorNotice message={op.error} />
      <fieldset
        disabled={op.busy}
        className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]"
      >
        <div className="min-w-0">
          <h2 className="mb-3 font-semibold">{candidate.locationName}</h2>
          <PalletScene
            {...props}
            {...(moving &&
            detail.placement &&
            detail.placement.zoneId === candidate.zoneId
              ? {
                  sourceFootprint: {
                    id: detail.placement._id,
                    label: tr("Source position", "ตำแหน่งต้นทาง"),
                    xMm: detail.placement.xMm,
                    yMm: detail.placement.yMm,
                    zMm: detail.placement.zMm,
                    widthMm: detail.placement.widthMm,
                    depthMm: detail.placement.depthMm,
                    heightMm: detail.placement.heightMm,
                  },
                }
              : {})}
            viewStateKey={previewKey ? `${previewKey}:view` : undefined}
            placement={placement}
            onPlacementChange={updatePlacement}
            automaticSupports={surfaces}
            baseSupport={base}
            {...(coordinateInvalid
              ? { issueMessage: coordinateMessage }
              : resolved.blockedReason
                ? { issueMessage: errorText(resolved.blockedReason, tr) }
                : {})}
            editable
            locale={locale}
            label={detail.pallet.code}
          />
        </div>
        <aside className={`${panel} space-y-4`}>
          <h2 className="font-semibold">
            {tr("Exact position", "ตำแหน่งที่แน่นอน")}
          </h2>
          {!moving && detail.pallet.status === "AWAITING_PLACEMENT" && (
            <Link
              onClick={onActivate}
              href={`${correctionPath(detail)}${correctionPath(detail).includes("?") ? "&" : "?"}returnToUnit=${encodeURIComponent(detail.pallet._id)}`}
              className="flex items-center gap-2 text-sm text-accent hover:underline"
            >
              <Pencil className="size-4" aria-hidden="true" />
              {tr("Edit measurements", "แก้ไขขนาด")} ·{" "}
              {mmText(props.dimensions.depthMm)} ×{" "}
              {mmText(props.dimensions.widthMm)} ×{" "}
              {mmText(props.dimensions.heightMm)}
            </Link>
          )}
          {moving && detail.destination && detail.placement ? (
            <section
              aria-label={tr(
                "Current stored position",
                "ตำแหน่งจัดเก็บปัจจุบัน",
              )}
              className="space-y-2 border-b border-border pb-4"
            >
              <h3 className="text-sm font-semibold">{tr("From", "จาก")}</h3>
              <DestinationSummary
                destination={detail.destination}
                placement={detail.placement}
              />
              <h3 className="text-sm font-semibold">{tr("To", "ไปยัง")}</h3>
            </section>
          ) : null}
          <DestinationSummary destination={candidate} placement={placement} />
          <p className="text-sm text-muted">
            {allowsPalletStacking
              ? tr(
                  "Drag onto a pallet to stack automatically; drag clear to return to the supporting floor or rack. Red shows why placement is not allowed.",
                  "ลากเหนือพาเลทเพื่อซ้อนอัตโนมัติ ลากออกเพื่อลงพื้นหรือชั้นวาง สีแดงแสดงตำแหน่งที่วางไม่ได้พร้อมเหตุผล",
                )
              : tr(
                  "Drag to adjust the position on the floor or rack. Red shows why placement is not allowed.",
                  "ลากเพื่อปรับตำแหน่งบนพื้นหรือชั้นวาง สีแดงแสดงตำแหน่งที่วางไม่ได้พร้อมเหตุผล",
                )}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="X (m)"
              value={coordinateDraft.x}
              onChange={(v) => updateCoordinate("x", v)}
              type="number"
              step="0.1"
            />
            <Field
              label="Y (m)"
              value={coordinateDraft.y}
              onChange={(v) => updateCoordinate("y", v)}
              type="number"
              step="0.1"
            />
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              updatePlacement({
                xMm: initialCandidate.xMm,
                yMm: initialCandidate.yMm,
                zMm: initialCandidate.zMm,
                rotation: initialCandidate.rotation,
              })
            }
          >
            {tr("Reset to recommendation", "คืนค่าที่แนะนำ")}
          </Button>
          {!issue && (
            <>
              <div className="space-y-2 border-t border-border pt-4 text-sm">
                {[
                  tr(
                    "Dimensions fit inside the support",
                    "ขนาดวางพอดีภายในฐานรองรับ",
                  ),
                  tr("Enough height clearance", "ความสูงเพียงพอ"),
                  tr(
                    "Does not overlap recorded occupancy",
                    "ไม่ทับตำแหน่งที่ระบบบันทึกไว้",
                  ),
                ].map((label) => (
                  <p
                    key={label}
                    className="flex items-center gap-2 text-success"
                  >
                    <Check className="size-4" aria-hidden="true" />
                    {label}
                  </p>
                ))}
                <p className="text-sm text-muted">
                  {candidate.checks.storageCondition === "MATCH"
                    ? tr("Storage condition matches", "เงื่อนไขจัดเก็บตรงกัน")
                    : tr(
                        "Storage condition is not configured for this location. Confirm suitability before reserving.",
                        "จุดนี้ยังไม่ระบุเงื่อนไขจัดเก็บ กรุณาตรวจสอบความเหมาะสมก่อนจอง",
                      )}
                </p>
              </div>
            </>
          )}{" "}
          {moving ? (
            <Field
              label={tr("Reason (optional)", "เหตุผล (ไม่บังคับ)")}
              value={reason}
              onChange={setReason}
              disabled={op.busy}
            />
          ) : null}
          <Notice
            title={tr(
              "Reserve first, then move the pallet",
              "จองพื้นที่ก่อนเคลื่อนย้ายพาเลท",
            )}
            body={
              moving
                ? tr(
                    "Both the source and destination stay held. The stored position changes only after destination verification and confirmation of physical placement.",
                    "ทั้งต้นทางและปลายทางยังถูกกันไว้ ตำแหน่งจัดเก็บจะเปลี่ยนหลังตรวจสอบปลายทางและยืนยันวางพาเลทจริงเท่านั้น",
                  )
                : tr(
                    "This holds the space. The pallet is marked stored only after destination verification and your physical confirmation.",
                    "ขั้นตอนนี้จองพื้นที่ พาเลทจะเป็นสถานะจัดเก็บแล้วหลังตรวจสอบปลายทางและยืนยันการวางจริง",
                  )
            }
          />
          <Button
            className="w-full"
            disabled={op.busy || !!issue || unchanged}
            onClick={() => void reserve()}
          >
            {op.busy
              ? tr("Reserving…", "กำลังจอง…")
              : tr("Reserve this position", "จองตำแหน่งนี้")}
          </Button>
          {unchanged ? (
            <Notice
              title={tr(
                "Choose a different position or orientation.",
                "เลือกตำแหน่งหรือทิศทางใหม่",
              )}
            />
          ) : null}
          {issue ? (
            <Notice
              tone="danger"
              title={tr(
                "This position is not valid. Adjust it before continuing.",
                "ตำแหน่งนี้ไม่ถูกต้อง กรุณาปรับก่อนดำเนินการต่อ",
              )}
            />
          ) : null}
        </aside>
      </fieldset>
    </div>
  );
}
