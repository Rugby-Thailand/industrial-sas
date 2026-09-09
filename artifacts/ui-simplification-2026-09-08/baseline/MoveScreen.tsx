"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { PalletScene } from "./PalletScene";
import {
  DestinationSummary,
  destinationKey,
  MoveHistory,
  PlacementEditor,
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
  mmText,
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
        key={`${detail.activeMove._id}:${detail.activeMove.status}`}
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
  const [selected, setSelected] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const candidates = outcome?.ok
    ? [
        ...outcome.value.candidates,
        ...("previewCandidates" in outcome.value
          ? outcome.value.previewCandidates
          : []),
      ]
    : [];
  const locationNeedle = locationSearch.trim().toLocaleLowerCase();
  const filteredCandidates = candidates.filter((candidate) =>
    [
      candidate.locationName,
      candidate.locationCode,
      candidate.buildingName,
      candidate.buildingCode,
      `Floor ${candidate.floorNumber}`,
      `ชั้น ${candidate.floorNumber}`,
      candidate.supportLabel,
      candidate.supportCode,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(locationNeedle),
  );
  const keyOf = destinationKey;
  const current =
    candidates.find((candidate) => keyOf(candidate) === selected) ??
    candidates[0];
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
      {detail.destination && detail.placement ? (
        <section
          aria-label={tr("Current stored position", "ตำแหน่งจัดเก็บปัจจุบัน")}
          className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm"
        >
          <h2 className="font-semibold text-muted">{tr("From", "จาก")}</h2>
          <p className="min-w-0 break-words">
            {detail.destination.buildingCode} · {tr("Floor", "ชั้น")}{" "}
            {detail.destination.floorNumber} → {detail.destination.locationName}
            {detail.destination.supportLabel || detail.destination.supportCode
              ? ` → ${detail.destination.supportLabel ?? detail.destination.supportCode}`
              : ""}
            {" → "}
            {detail.destination.positionCode}
          </p>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {[
              ["X", mmText(detail.placement.xMm)],
              ["Y", mmText(detail.placement.yMm)],
              [
                "Z",
                mmText(detail.placement.zMm ?? detail.destination.support.zMm),
              ],
              [tr("Orientation", "ทิศทาง"), `${detail.placement.rotation}°`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-1">
                <dt className="text-muted">{label}</dt>
                <dd className="font-mono">{value}</dd>
              </div>
            ))}
          </dl>
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
          <section className="min-w-0 space-y-3">
            <h2 className="text-sm font-semibold">
              {tr("Available destinations", "ปลายทางที่ใช้ได้")}
              <span className="ml-2 font-normal text-muted" aria-live="polite">
                {locationNeedle
                  ? `${filteredCandidates.length} / ${candidates.length}`
                  : candidates.length}
              </span>
            </h2>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <Input
                aria-label={tr("Search move destinations", "ค้นหาปลายทางย้าย")}
                placeholder={tr(
                  "Building, location or rack…",
                  "อาคาร จุดจัดเก็บ หรือชั้นวาง…",
                )}
                value={locationSearch}
                onChange={(event) => setLocationSearch(event.target.value)}
                className="pr-12 pl-9"
              />
              {locationSearch && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1/2 right-0 -translate-y-1/2"
                  aria-label={tr("Clear search", "ล้างคำค้น")}
                  title={tr("Clear search", "ล้างคำค้น")}
                  onClick={() => setLocationSearch("")}
                >
                  <X aria-hidden="true" />
                </Button>
              )}
            </div>
            {filteredCandidates.length === 0 ? (
              <div className="space-y-2 rounded-xl border border-dashed border-border p-4 text-sm">
                <p role="status">
                  {tr("No matching destinations", "ไม่พบปลายทางที่ตรงกัน")}
                </p>
                <p className="text-xs text-muted">
                  {tr(
                    "Your current preview is kept. Clear the search to see all destinations.",
                    "ภาพตำแหน่งที่เลือกยังคงอยู่ ล้างคำค้นเพื่อดูปลายทางทั้งหมด",
                  )}
                </p>
              </div>
            ) : (
              <div
                role="region"
                aria-label={tr("Destination options", "ตัวเลือกปลายทาง")}
                tabIndex={0}
                className="flex gap-2 overflow-x-auto rounded-xl pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring 2xl:max-h-[32rem] 2xl:flex-col 2xl:overflow-y-auto 2xl:pr-2"
              >
                {filteredCandidates.map((candidate) => (
                  <button
                    key={keyOf(candidate)}
                    type="button"
                    aria-pressed={keyOf(candidate) === keyOf(current)}
                    className={`min-w-52 shrink-0 rounded-xl border p-3 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset 2xl:min-w-0 ${keyOf(candidate) === keyOf(current) ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/60"}`}
                    onClick={() => setSelected(keyOf(candidate))}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <MapPin
                        className="size-4 text-accent"
                        aria-hidden="true"
                      />
                      {candidate.locationName}
                    </span>
                    <span className="mt-2 block text-xs text-muted">
                      {candidate.buildingCode} · {tr("Floor", "ชั้น")}{" "}
                      {candidate.floorNumber}
                    </span>
                    <span className="mt-2 block text-xs text-muted">
                      {candidate.supportLabel ??
                        candidate.supportCode ??
                        tr("Location floor", "พื้นจุดจัดเก็บ")}
                      {" · Z "}
                      {candidate.zMm / 1000} m
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <PlacementEditor
            key={keyOf(current)}
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
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 shrink-0 accent-accent"
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
        if (!identified || !physicalConfirmed) return false;
        const args = { ...base, ...identified, physicalConfirmed };
        written(
          await startMutation({
            ...args,
            requestId: op.request(`start:${JSON.stringify(args)}`),
          }),
        );
      } else if (kind === "complete") {
        if (!physicalConfirmed || !move.destinationVerifiedForCurrentUser)
          return false;
        written(
          await completeMutation({
            ...base,
            physicalConfirmed,
            requestId: op.request("complete"),
          }),
        );
      } else if (kind === "cancel") {
        written(
          await cancelMutation({ ...base, requestId: op.request("cancel") }),
        );
      } else if (kind === "return") {
        if (!returnCode || !returnAcknowledged) return false;
        const args = {
          ...base,
          ...returnCode,
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
    <>
      <Heading
        back={palletPath(detail.pallet._id)}
        backLabel={tr("Back to pallet", "กลับไปที่พาเลท")}
        title={
          inTransit
            ? tr("Pallet is moving", "กำลังย้ายพาเลท")
            : tr("Move prepared", "เตรียมย้ายแล้ว")
        }
        description={tr(
          "Both spaces stay held. Only confirmation of placement or return releases a hold.",
          "ทั้งสองพื้นที่ยังถูกกันไว้ ระบบคืนพื้นที่เมื่อยืนยันการวางหรือคืนต้นทางเท่านั้น",
        )}
      />
      <Summary detail={detail} />
      <div className="mb-5">
        <Notice
          tone="warning"
          title={
            inTransit
              ? tr(
                  "Source is the last confirmed position",
                  "ต้นทางคือตำแหน่งที่ยืนยันล่าสุด",
                )
              : tr(
                  "Destination reserved · Awaiting pickup",
                  "จองปลายทางแล้ว · รอรับพาเลท",
                )
          }
          {...(move.issue ? { body: move.issue } : {})}
        />
      </div>
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
      <div className="mb-5 grid gap-4 md:grid-cols-2">
        {[
          {
            title: inTransit
              ? tr(
                  "From · Last confirmed position",
                  "จาก · ตำแหน่งที่ยืนยันล่าสุด",
                )
              : tr("From", "จาก"),
            destination: move.sourceDestination,
            placement: move.sourcePlacement,
          },
          {
            title: tr("To · Reserved destination", "ไปยัง · ปลายทางที่จอง"),
            destination: move.targetDestination,
            placement: move.targetPlacement,
          },
        ].map(({ title, destination, placement }) => (
          <section key={title} className={panel}>
            <h2 className="mb-3 font-semibold">{title}</h2>
            {destination && placement ? (
              <DestinationSummary
                destination={destination}
                placement={placement}
              />
            ) : (
              <Notice
                tone="danger"
                title={tr(
                  "Location unavailable. Keep both holds and report an issue.",
                  "ไม่พบข้อมูลจุดจัดเก็บ กรุณาคงพื้นที่ที่กันไว้และรายงานปัญหา",
                )}
              />
            )}
          </section>
        ))}
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
        {move.targetDestination && move.targetPlacement ? (
          <section className={panel}>
            <h2 className="mb-3 font-semibold">
              {tr("Exact destination", "ปลายทางที่แน่นอน")}
            </h2>
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
          <section className={`${panel} space-y-4`}>
            <h2 className="font-semibold">
              {inTransit
                ? tr(
                    "Verify destination and place pallet",
                    "ตรวจสอบปลายทางและวางพาเลท",
                  )
                : tr("Identify pallet before pickup", "ตรวจสอบพาเลทก่อนรับ")}
            </h2>
            {inTransit ? (
              <DestinationScanner
                storageFormat={
                  detail.pallet.storageFormat ?? detail.product?.storageFormat
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
                  detail.pallet.storageFormat ?? detail.product?.storageFormat
                }
                onCode={identify}
                busy={op.busy}
                verified={!!identified}
                expectedLocation={detail.pallet.code}
                showVerificationErrors={false}
                purpose="PALLET"
              />
            )}
            <Acknowledgement
              checked={physicalConfirmed}
              onChange={setPhysicalConfirmed}
              disabled={op.busy}
            >
              {inTransit
                ? tr(
                    "I have placed this pallet at the exact destination coordinates and orientation shown.",
                    "ฉันวางพาเลทนี้ตามพิกัดและทิศทางปลายทางที่แสดงแล้ว",
                  )
                : tr(
                    "I have physically picked up this pallet from the source.",
                    "ฉันรับพาเลทนี้จากต้นทางแล้วจริง",
                  )}
            </Acknowledgement>
            <ErrorNotice message={op.error} />
            <Button
              className="w-full"
              disabled={
                op.busy ||
                !physicalConfirmed ||
                (inTransit
                  ? !move.destinationVerifiedForCurrentUser
                  : !identified)
              }
              onClick={() => void command(inTransit ? "complete" : "start")}
            >
              {inTransit
                ? tr("Confirm placed here", "ยืนยันวางแล้ว")
                : tr("Start move", "เริ่มย้าย")}
            </Button>
            <p className="text-xs text-muted">
              {tr(
                "A code identifies the pallet or location. You must also confirm the physical action.",
                "รหัสใช้ระบุพาเลทหรือจุดจัดเก็บ คุณต้องยืนยันการปฏิบัติงานจริงด้วย",
              )}
            </p>
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
              {move.sourceDestination && move.sourcePlacement ? (
                <DestinationSummary
                  destination={move.sourceDestination}
                  placement={move.sourcePlacement}
                />
              ) : null}
              <DestinationScanner
                storageFormat={
                  detail.pallet.storageFormat ?? detail.product?.storageFormat
                }
                purpose={
                  move.sourceDestination?.supportPalletId ? "SUPPORT" : "SOURCE"
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
              <Acknowledgement
                checked={returnAcknowledged}
                onChange={setReturnAcknowledged}
                disabled={op.busy}
              >
                {tr(
                  "I have returned this pallet to the exact source position and orientation shown.",
                  "ฉันคืนพาเลทนี้ตามตำแหน่งและทิศทางต้นทางที่แสดงแล้วจริง",
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
                (dialog === "return" && (!returnCode || !returnAcknowledged)) ||
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
    </>
  );
}
