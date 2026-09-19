"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
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
import { useRouter } from "@/i18n/navigation";
import { fgRefs, type PalletDetail } from "@/lib/convex/finishedGoodsApi";
import { DestinationScanner } from "./DestinationScanner";
import { DestinationPicker, destinationKey } from "./DestinationPicker";
import { PlacementEditor } from "./PlacementEditor";
import { usePreviewState } from "./usePreviewState";
import { PalletScene } from "./PalletScene";
import {
  DestinationSummary,
  MoveHistory,
  Summary,
  recommendationReason,
  sceneProps,
} from "./PalletScreens";
import {
  ErrorNotice,
  Field,
  Heading,
  Loading,
  Missing,
  palletPath,
  panel,
  useCanManage,
  useDraftKey,
  useUnitText,
  useOperation,
  written,
} from "./shared";

export function MoveScreen({ palletId }: { palletId: string }) {
  const actorScope = useDraftKey("fg-move");
  if (!actorScope) return <Loading />;
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <MoveLoader
          key={`${actorScope}:${warehouseId}:${palletId}`}
          warehouseId={warehouseId}
          palletId={palletId}
          actorScope={actorScope}
        />
      )}
    </QueryGate>
  );
}

function MoveLoader({
  warehouseId,
  palletId,
  actorScope,
}: {
  warehouseId: string;
  palletId: string;
  actorScope: string;
}) {
  const outcome = useQuery(fgRefs.getPallet, { warehouseId, palletId });
  const canManage = useCanManage();
  const [changeDestination, setChangeDestination] = useState(false);
  const { tr } = useUnitText(
    outcome?.ok
      ? (outcome.value?.pallet.storageFormat ??
          outcome.value?.product?.storageFormat)
      : undefined,
  );
  if (!outcome) return <Loading />;
  if (!outcome.ok || !outcome.value) return <Missing />;
  const detail = outcome.value;
  if (
    detail.activeMove &&
    !(
      changeDestination &&
      canManage &&
      detail.activeMove.isOwner &&
      detail.activeMove.status === "RESERVED"
    )
  )
    return (
      <ActiveMove
        key={`${detail.activeMove._id}:${detail.activeMove.status}:${detail.activeMove.targetPlacementId}:${detail.activeMove.targetUpdatedAt}`}
        detail={detail}
        warehouseId={warehouseId}
        actorScope={actorScope}
        onChangeDestination={() => setChangeDestination(true)}
      />
    );
  if (
    !canManage ||
    detail.pallet.status !== "STORED" ||
    !detail.placement ||
    detail.placement.mode === "LOCATION_ONLY" ||
    !detail.destination
  )
    return (
      <>
        <Heading
          title={tr("Move pallet", "ย้ายพาเลท")}
          back={palletPath(palletId)}
          backLabel={tr("Back to pallet", "กลับไปที่พาเลท")}
        />
        <Notice
          title={
            !canManage
              ? tr("View-only access", "สิทธิ์ดูข้อมูลเท่านั้น")
              : detail.placement?.mode === "LOCATION_ONLY"
                ? tr(
                    "This unit has a saved location without measured coordinates. Moving and stacking are not available for this assignment.",
                    "บรรจุภัณฑ์นี้บันทึกจุดจัดเก็บโดยไม่มีพิกัดที่วัด ยังไม่รองรับการย้ายและซ้อนสำหรับรายการนี้",
                  )
                : tr(
                    "Only a stored pallet with a valid source can be moved.",
                    "ย้ายได้เฉพาะพาเลทที่จัดเก็บแล้วและมีข้อมูลต้นทางครบถ้วน",
                  )
          }
        />

        <MoveHistory detail={detail} />
      </>
    );
  return (
    <MoveSelection
      detail={detail}
      warehouseId={warehouseId}
      onReserved={() => setChangeDestination(false)}
    />
  );
}

function MoveSelection({
  detail,
  warehouseId,
  onReserved,
}: {
  detail: PalletDetail;
  warehouseId: string;
  onReserved: () => void;
}) {
  const { tr } = useUnitText(
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const outcome = useQuery(fgRefs.recommendMove, {
    warehouseId,
    palletId: detail.pallet._id,
  });
  const pickerScope = useDraftKey("fg-move-destinations");
  const pickerKey = pickerScope
    ? `${pickerScope}:${warehouseId}:${detail.pallet._id}`
    : undefined;
  const [selection, setSelection] = usePreviewState(pickerKey, {
    selected: "",
  });
  const selected = selection.selected;
  const setSelected = (selected: string) => setSelection({ selected });
  // Preview-only areas have no valid placement for this pallet. They must
  // never be counted or selected as available move destinations.
  const candidates = outcome?.ok ? outcome.value.candidates : [];
  const keyOf = destinationKey;
  const current = selected
    ? candidates.find((candidate) => keyOf(candidate) === selected)
    : candidates[0];
  const picker = (
    <DestinationPicker
      stateKey={pickerKey ? `${pickerKey}:search` : undefined}
      context="move"
      candidates={candidates}
      selected={current ? keyOf(current) : ""}
      onSelect={setSelected}
    />
  );
  return (
    <>
      <Heading
        back={palletPath(detail.pallet._id)}
        backLabel={tr("Back to pallet", "กลับไปที่พาเลท")}
        title={tr("Move pallet", "ย้ายพาเลท")}
        description={tr(
          "Choose an exact destination. The source stays occupied until the move or a physical return is confirmed.",
          "เลือกตำแหน่งปลายทางที่แน่นอน ต้นทางยังถูกกันไว้จนกว่าจะยืนยันการย้ายหรือคืนพาเลทจริง",
        )}
      />
      <Summary detail={detail} />
      {!current &&
      detail.destination &&
      detail.placement &&
      detail.placement.mode !== "LOCATION_ONLY" ? (
        <section
          aria-label={tr("Current stored position", "ตำแหน่งจัดเก็บปัจจุบัน")}
          className={`${panel} mb-4`}
        >
          <h2 className="mb-2 font-semibold">{tr("From", "จาก")}</h2>
          <DestinationSummary
            destination={detail.destination}
            placement={detail.placement}
          />
        </section>
      ) : null}
      {!outcome ? (
        <Loading />
      ) : !outcome.ok ? (
        <Notice
          tone="danger"
          title={tr(
            "Could not load destinations. Refresh to retry.",
            "โหลดปลายทางไม่ได้ กรุณารีเฟรชเพื่อลองใหม่",
          )}
        />
      ) : !current && candidates.length > 0 ? (
        <div className="space-y-4">
          <Notice
            tone="warning"
            title={tr(
              "The previous location is no longer available. Select another destination to continue.",
              "จุดเดิมไม่พร้อมใช้งานแล้ว เลือกปลายทางใหม่เพื่อดำเนินการต่อ",
            )}
          />
          {picker}
        </div>
      ) : !current ? (
        <section className={`${panel} space-y-3`}>
          <Notice
            title={tr("No suitable space found", "ไม่พบพื้นที่ที่เหมาะสม")}
            body={tr(
              "The pallet remains at its current position. Check available space or try again later.",
              "พาเลทยังอยู่ที่เดิม กรุณาตรวจสอบพื้นที่ว่างหรือลองอีกครั้งภายหลัง",
            )}
          />
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {outcome.value.reasons.map((reason) => (
              <li key={reason}>{recommendationReason(reason, tr)}</li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="grid items-start gap-4 2xl:grid-cols-[230px_1fr]">
          {picker}
          <PlacementEditor
            key={keyOf(current)}
            onActivate={() => setSelected(keyOf(current))}
            warehouseId={warehouseId}
            detail={detail}
            candidate={current}
            destinations={candidates}
            moving
            onReserved={onReserved}
          />
        </div>
      )}
    </>
  );
}

function Acknowledgement({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm font-medium">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-accent"
      />
      <span>{children}</span>
    </label>
  );
}

function ActiveMove({
  detail,
  warehouseId,
  actorScope,
  onChangeDestination,
}: {
  detail: PalletDetail;
  warehouseId: string;
  actorScope: string;
  onChangeDestination: () => void;
}) {
  const { tr, locale } = useUnitText(
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const router = useRouter();
  const canManage = useCanManage();
  const startMutation = useMutation(fgRefs.startMove);
  const verifyMutation = useMutation(fgRefs.verifyMoveDestination);
  const completeMutation = useMutation(fgRefs.completeMove);
  const cancelMutation = useMutation(fgRefs.cancelMove);
  const returnMutation = useMutation(fgRefs.returnMove);
  const issueMutation = useMutation(fgRefs.reportMoveIssue);
  const move = detail.activeMove!;
  const op = useOperation(
    `${actorScope}:${warehouseId}:${move._id}`,
    detail.pallet.storageFormat ?? detail.product?.storageFormat,
  );
  const [physicalConfirmed, setPhysicalConfirmed] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [returnScanMode, setReturnScanMode] = useState(false);
  const [identified, setIdentified] = useState<{
    code: string;
    method: "SCAN" | "MANUAL";
  } | null>(null);
  const [dialog, setDialog] = useState<"cancel" | "return" | "issue" | null>(
    null,
  );
  const [returnAcknowledged, setReturnAcknowledged] = useState(false);
  const [returnCode, setReturnCode] = useState<{
    code: string;
    method: "SCAN" | "MANUAL";
  } | null>(null);
  const [issue, setIssue] = useState("");
  const [issueSaved, setIssueSaved] = useState(false);
  const owner = canManage && move.isOwner;
  const inTransit = move.status === "IN_TRANSIT";
  const base = { warehouseId, palletId: detail.pallet._id, moveId: move._id };
  async function command(
    kind: "start" | "complete" | "cancel" | "return" | "issue",
  ) {
    if (!owner) return;
    const result = await op.run(async () => {
      if (kind === "start") {
        if (!physicalConfirmed || (scanMode && !identified)) return false;
        const args = {
          ...base,
          ...(scanMode
            ? identified!
            : { confirmationMethod: "ACKNOWLEDGEMENT" as const }),
          physicalConfirmed,
        };
        written(
          await startMutation({
            ...args,
            requestId: op.request(`start:${JSON.stringify(args)}`),
          }),
        );
      } else if (kind === "complete") {
        if (
          !physicalConfirmed ||
          (scanMode && !move.destinationVerifiedForCurrentUser)
        )
          return false;
        written(
          await completeMutation({
            ...base,
            ...(!scanMode
              ? { confirmationMethod: "ACKNOWLEDGEMENT" as const }
              : {}),
            physicalConfirmed,
            requestId: op.request(
              `complete:${scanMode ? "verified" : "acknowledged"}`,
            ),
          }),
        );
      } else if (kind === "cancel") {
        written(
          await cancelMutation({ ...base, requestId: op.request("cancel") }),
        );
      } else if (kind === "return") {
        if (!returnAcknowledged || (returnScanMode && !returnCode))
          return false;
        const args = {
          ...base,
          ...(returnScanMode
            ? returnCode!
            : { confirmationMethod: "ACKNOWLEDGEMENT" as const }),
          physicalConfirmed: returnAcknowledged,
        };
        written(
          await returnMutation({
            ...args,
            requestId: op.request(`return:${JSON.stringify(args)}`),
          }),
        );
      } else {
        if (!issue.trim()) return false;
        written(
          await issueMutation({
            ...base,
            issue: issue.trim(),
            requestId: op.request(`issue:${issue.trim()}`),
          }),
        );
        setIssueSaved(true);
      }
      return true;
    });
    if (result) {
      op.clearRequests();
      setDialog(null);
      setPhysicalConfirmed(false);
      if (kind === "complete" || kind === "cancel" || kind === "return")
        router.push(palletPath(detail.pallet._id));
    }
  }
  async function verify(code: string, method: "SCAN" | "MANUAL") {
    if (!owner) throw new Error("ACCESS_DENIED");
    const result = await op.run(async () => {
      written(
        await verifyMutation({
          ...base,
          code,
          method,
          requestId: op.request(`verify:${code}:${method}`),
        }),
      );
      return true;
    });
    if (!result) throw new Error("Verification failed");
    op.clearRequests();
  }
  async function identify(code: string, method: "SCAN" | "MANUAL") {
    if (
      code !== detail.pallet.code &&
      code !== `ISAS:PALLET:1:${detail.pallet._id}`
    ) {
      op.setError(
        tr(
          "This code does not identify this pallet. Check its label and retry.",
          "รหัสนี้ไม่ใช่พาเลทนี้ กรุณาตรวจสอบป้ายแล้วลองอีกครั้ง",
        ),
      );
      throw new Error("PALLET_MISMATCH");
    }
    op.setError("");
    setIdentified({ code, method });
  }
  return (
    <div className="pb-48 md:pb-0">
      <Heading
        back={palletPath(detail.pallet._id)}
        backLabel={tr("Back to pallet", "กลับไปที่พาเลท")}
        title={
          inTransit
            ? tr("Confirm pallet move", "ยืนยันย้ายพาเลท")
            : tr("Move prepared", "เตรียมย้ายแล้ว")
        }
      />
      <ol
        aria-label={tr("Move progress", "ขั้นตอนการย้าย")}
        className="mb-5 flex flex-wrap items-center gap-3 text-sm"
      >
        {[
          tr("Destination selected", "เลือกปลายทางแล้ว"),
          inTransit
            ? tr("Moving", "กำลังย้าย")
            : tr("Awaiting pickup", "รอรับพาเลท"),
          tr("Complete", "เสร็จ"),
        ].map((step, index) => (
          <li
            key={index}
            aria-current={index === 1 ? "step" : undefined}
            className={index === 1 ? "font-semibold text-accent" : "text-muted"}
          >
            {index === 0 ? "✓" : `${index + 1}.`} {step}
          </li>
        ))}
      </ol>
      <Summary detail={detail} compact />
      {move.issue ? (
        <div className="mb-5">
          <Notice tone="warning" title={move.issue} />
        </div>
      ) : null}
      {!owner ? (
        <div className="mb-5">
          <Notice
            title={tr("View-only move", "ดูการย้ายเท่านั้น")}
            body={tr(
              "Only the operator who prepared this move can continue it. Other operators can view progress.",
              "เฉพาะผู้เตรียมการย้ายนี้เท่านั้นที่ดำเนินการต่อได้ ผู้ปฏิบัติงานอื่นสามารถดูความคืบหน้าได้",
            )}
          />
        </div>
      ) : null}
      <div className="mb-6 grid grid-cols-2 gap-5 text-sm">
        <div>
          <p className="text-xs text-muted">{tr("From", "จาก")}</p>
          {move.sourceDestination?.locationCode !==
            move.targetDestination?.locationCode ||
          move.sourceDestination?.buildingCode !==
            move.targetDestination?.buildingCode ||
          move.sourceDestination?.floorNumber !==
            move.targetDestination?.floorNumber ? (
            <p className="mt-1 break-words">
              {move.sourceDestination
                ? `${move.sourceDestination.buildingCode} · ${tr("Floor", "ชั้น")} ${move.sourceDestination.floorNumber} · ${move.sourceDestination.locationName}`
                : tr("Location unavailable", "ไม่พบข้อมูลจุดจัดเก็บ")}
            </p>
          ) : null}
          <p className="mt-1 font-mono text-sm">
            {move.sourcePlacement?.positionCode}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">{tr("To", "ปลายทาง")}</p>
          {move.sourceDestination?.locationCode !==
            move.targetDestination?.locationCode ||
          move.sourceDestination?.buildingCode !==
            move.targetDestination?.buildingCode ||
          move.sourceDestination?.floorNumber !==
            move.targetDestination?.floorNumber ? (
            <p className="mt-1 break-words">
              {move.targetDestination
                ? `${move.targetDestination.buildingCode} · ${tr("Floor", "ชั้น")} ${move.targetDestination.floorNumber} · ${move.targetDestination.locationName}`
                : tr("Location unavailable", "ไม่พบข้อมูลจุดจัดเก็บ")}
            </p>
          ) : null}
          <p className="mt-1 font-mono text-sm">
            {move.targetPlacement?.positionCode}
          </p>
        </div>
      </div>
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {move.targetDestination &&
        move.targetPlacement &&
        move.targetPlacement.mode !== "LOCATION_ONLY" ? (
          <section className="order-2 min-w-0 md:order-1">
            <PalletScene
              {...sceneProps(move.targetDestination, detail)}
              placement={move.targetPlacement}
              status="RESERVED"
              locale={locale}
              label={detail.pallet.code}
            />
          </section>
        ) : null}
        {owner ? (
          <section className={`${panel} order-1 min-w-0 space-y-4 md:order-2`}>
            <h2 className="font-semibold">
              {inTransit
                ? tr("Place at this destination", "วางที่ปลายทางนี้")
                : tr("Pick up this pallet", "รับพาเลทจากต้นทาง")}
            </h2>
            {inTransit ? (
              move.targetDestination &&
              move.targetPlacement &&
              move.targetPlacement.mode !== "LOCATION_ONLY" ? (
                <DestinationSummary
                  destination={move.targetDestination}
                  placement={move.targetPlacement}
                />
              ) : (
                <Notice
                  tone="danger"
                  title={tr("Location unavailable", "ไม่พบข้อมูลจุดจัดเก็บ")}
                />
              )
            ) : move.sourceDestination &&
              move.sourcePlacement &&
              move.sourcePlacement.mode !== "LOCATION_ONLY" ? (
              <DestinationSummary
                destination={move.sourceDestination}
                placement={move.sourcePlacement}
              />
            ) : (
              <Notice
                tone="danger"
                title={tr("Location unavailable", "ไม่พบข้อมูลจุดจัดเก็บ")}
              />
            )}
            <div className="fixed inset-x-0 bottom-0 z-30 space-y-3 border-t border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none">
              <Acknowledgement
                checked={physicalConfirmed}
                onChange={setPhysicalConfirmed}
                disabled={op.busy}
              >
                {inTransit
                  ? tr(
                      `Placed ${detail.pallet.code} at the shown position and orientation.`,
                      `วาง ${detail.pallet.code} ตามตำแหน่งและทิศทางนี้แล้ว`,
                    )
                  : tr(
                      `Picked up ${detail.pallet.code} from the source.`,
                      `รับ ${detail.pallet.code} จากต้นทางแล้ว`,
                    )}
              </Acknowledgement>
              <ErrorNotice message={op.error} />
              <Button
                className="w-full"
                disabled={
                  op.busy ||
                  !physicalConfirmed ||
                  (scanMode &&
                    (inTransit
                      ? !move.destinationVerifiedForCurrentUser
                      : !identified))
                }
                onClick={() => void command(inTransit ? "complete" : "start")}
              >
                {inTransit
                  ? tr("Confirm move complete", "ยืนยันย้ายเสร็จ")
                  : tr("Start move", "เริ่มย้าย")}
              </Button>
              <p className="text-sm text-muted" aria-live="polite">
                {inTransit
                  ? tr(
                      "Confirming releases the source space.",
                      "ยืนยันแล้วคืนพื้นที่ต้นทาง",
                    )
                  : tr(
                      "Tick after pickup. Both spaces stay reserved.",
                      "ติ๊กเมื่อรับแล้ว ทั้งสองพื้นที่ยังกันไว้",
                    )}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full bg-transparent"
              aria-expanded={scanMode}
              disabled={op.busy}
              onClick={() => {
                setScanMode(!scanMode);
                setPhysicalConfirmed(false);
                op.setError("");
              }}
            >
              {scanMode
                ? tr("Use checkbox instead", "ใช้ checkbox แทนการสแกน")
                : tr("Scan QR (optional)", "สแกน QR (ไม่บังคับ)")}
            </Button>
            {scanMode && (
              <div>
                {inTransit ? (
                  <DestinationScanner
                    storageFormat={
                      detail.pallet.storageFormat ??
                      detail.product?.storageFormat
                    }
                    onCode={verify}
                    busy={op.busy}
                    verified={move.destinationVerifiedForCurrentUser}
                    expectedLocation={
                      move.targetDestination?.supportPalletId
                        ? (move.targetDestination.supportCode ?? "")
                        : (move.targetDestination?.locationName ?? "")
                    }
                    purpose={
                      move.targetDestination?.supportPalletId
                        ? "SUPPORT"
                        : "DESTINATION"
                    }
                    showVerificationErrors={false}
                  />
                ) : (
                  <DestinationScanner
                    storageFormat={
                      detail.pallet.storageFormat ??
                      detail.product?.storageFormat
                    }
                    onCode={identify}
                    busy={op.busy}
                    verified={!!identified}
                    expectedLocation={detail.pallet.code}
                    showVerificationErrors={false}
                    purpose="PALLET"
                  />
                )}
              </div>
            )}
          </section>
        ) : null}
      </div>
      {issueSaved ? (
        <div className="mt-4">
          <Notice
            title={tr(
              "Issue saved. Both spaces remain held.",
              "บันทึกปัญหาแล้ว ทั้งสองพื้นที่ยังถูกกันไว้",
            )}
          />
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        {owner ? (
          <div className="flex flex-wrap gap-2">
            {!inTransit ? (
              <Button
                variant="outline"
                disabled={op.busy}
                onClick={onChangeDestination}
              >
                {tr("Change destination", "เปลี่ยนปลายทาง")}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={op.busy}
              onClick={() => {
                op.setError("");
                setReturnAcknowledged(false);
                setReturnCode(null);
                setReturnScanMode(false);
                setDialog(inTransit ? "return" : "cancel");
              }}
            >
              {inTransit
                ? tr("Return to source", "คืนต้นทาง")
                : tr("Cancel move", "ยกเลิกการย้าย")}
            </Button>
            <Button
              variant="outline"
              disabled={op.busy}
              onClick={() => {
                op.setError("");
                setDialog("issue");
              }}
            >
              {tr("Report an issue", "รายงานปัญหา")}
            </Button>
          </div>
        ) : null}
      </div>
      <MoveHistory detail={detail} />
      <Dialog
        open={!!dialog && owner}
        onOpenChange={(open) => {
          if (!open && !op.busy) {
            setDialog(null);
            setReturnAcknowledged(false);
            setReturnCode(null);
          }
        }}
      >
        <DialogContent closeLabel={tr("Close", "ปิด")}>
          <DialogHeader>
            <DialogTitle>
              {dialog === "cancel"
                ? tr("Cancel this move?", "ยกเลิกการย้ายนี้?")
                : dialog === "return"
                  ? tr(
                      "Confirm physical return to source",
                      "ยืนยันคืนพาเลทต้นทางจริง",
                    )
                  : tr("Report an issue", "รายงานปัญหา")}
            </DialogTitle>
            <DialogDescription>
              {dialog === "cancel"
                ? tr(
                    "Only the destination reservation is released. The pallet remains stored at the source.",
                    "คืนเฉพาะพื้นที่ปลายทางที่จอง พาเลทยังคงจัดเก็บที่ต้นทาง",
                  )
                : tr(
                    "Both spaces remain held until the physical move or return is confirmed.",
                    "ทั้งสองพื้นที่ยังถูกกันไว้จนกว่าจะยืนยันการย้ายหรือคืนจริง",
                  )}
            </DialogDescription>
          </DialogHeader>
          {dialog === "return" ? (
            <div className="space-y-4">
              {move.sourceDestination &&
              move.sourcePlacement &&
              move.sourcePlacement.mode !== "LOCATION_ONLY" ? (
                <DestinationSummary
                  destination={move.sourceDestination}
                  placement={move.sourcePlacement}
                />
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={op.busy}
                aria-expanded={returnScanMode}
                onClick={() => {
                  setReturnScanMode(!returnScanMode);
                  setReturnAcknowledged(false);
                  op.setError("");
                }}
              >
                {returnScanMode
                  ? tr("Use checkbox instead", "ใช้ checkbox แทนการสแกน")
                  : tr(
                      "Scan source QR (optional)",
                      "สแกน QR ต้นทาง (ไม่บังคับ)",
                    )}
              </Button>
              {returnScanMode && (
                <div>
                  <DestinationScanner
                    storageFormat={
                      detail.pallet.storageFormat ??
                      detail.product?.storageFormat
                    }
                    purpose={
                      move.sourceDestination?.supportPalletId
                        ? "SUPPORT"
                        : "SOURCE"
                    }
                    expectedLocation={
                      move.sourceDestination?.supportPalletId
                        ? (move.sourceDestination.supportCode ?? "")
                        : (move.sourceDestination?.locationName ?? "")
                    }
                    busy={op.busy}
                    verified={!!returnCode}
                    showVerificationErrors={false}
                    onCode={async (code, method) => {
                      const accepted = move.sourceDestination?.supportPalletId
                        ? [
                            move.sourceDestination.supportCode,
                            `ISAS:PALLET:1:${move.sourceDestination.supportPalletId}`,
                          ]
                        : [
                            move.sourceDestination?.locationQrValue,
                            move.sourceDestination?.locationCode,
                            move.sourcePlacement?.qrValue,
                            move.sourcePlacement?.positionCode,
                          ];
                      if (
                        !accepted.some(
                          (c) =>
                            c === code ||
                            (method === "MANUAL" &&
                              c?.toUpperCase() === code.trim().toUpperCase()),
                        )
                      ) {
                        op.setError(
                          tr(
                            "This code does not match the source.",
                            "รหัสไม่ตรงกับต้นทาง",
                          ),
                        );
                        throw new Error("SOURCE_MISMATCH");
                      }
                      op.setError("");
                      setReturnCode({ code, method });
                    }}
                  />
                </div>
              )}
              <Acknowledgement
                checked={returnAcknowledged}
                onChange={setReturnAcknowledged}
                disabled={op.busy}
              >
                {tr(
                  `Returned ${detail.pallet.code} to the shown source position and orientation.`,
                  `คืน ${detail.pallet.code} ตามตำแหน่งและทิศทางต้นทางแล้ว`,
                )}
              </Acknowledgement>
            </div>
          ) : dialog === "issue" ? (
            <Field
              label={tr("Describe the issue", "รายละเอียดปัญหา")}
              value={issue}
              onChange={setIssue}
              disabled={op.busy}
            />
          ) : null}
          <ErrorNotice message={op.error} />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={op.busy}
              onClick={() => setDialog(null)}
            >
              {tr("Close", "ปิด")}
            </Button>
            <Button
              disabled={
                op.busy ||
                (dialog === "return" &&
                  (!returnAcknowledged || (returnScanMode && !returnCode))) ||
                (dialog === "issue" && !issue.trim())
              }
              onClick={() => {
                if (dialog) void command(dialog);
              }}
            >
              {dialog === "cancel"
                ? tr("Cancel move", "ยกเลิกการย้าย")
                : dialog === "return"
                  ? tr("Confirm returned", "ยืนยันคืนแล้ว")
                  : tr("Save issue", "บันทึกปัญหา")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
