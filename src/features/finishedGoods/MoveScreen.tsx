"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { Panel } from "@/components/ui/Panel";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { PageContainer } from "@/components/ui/PageContainer";
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
  const { t } = useUnitText(
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
          title={t("copy.move-pallet")}
          back={palletPath(palletId)}
          backLabel={t("copy.back-to-pallet")}
        />
        <Notice
          title={
            !canManage
              ? t("copy.view-only-access")
              : detail.placement?.mode === "LOCATION_ONLY"
                ? t(
                    "copy.this-unit-has-a-saved-location-without-measured-coordinates-moving-and-s",
                  )
                : t(
                    "copy.only-a-stored-pallet-with-a-valid-source-can-be-moved",
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
  const { t, tr } = useUnitText(
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
        backLabel={t("copy.back-to-pallet")}
        title={t("copy.move-pallet")}
        description={t(
          "copy.choose-an-exact-destination-the-source-stays-occupied-until-the-move-or-",
        )}
      />
      <Summary detail={detail} />
      {!current &&
      detail.destination &&
      detail.placement &&
      detail.placement.mode !== "LOCATION_ONLY" ? (
        <Panel
          as="section"
          aria-label={t("copy.current-stored-position")}
          className="mb-4"
        >
          <h2 className="mb-2 text-lg leading-7 font-semibold">
            {t("copy.from")}
          </h2>
          <DestinationSummary
            destination={detail.destination}
            placement={detail.placement}
          />
        </Panel>
      ) : null}
      {!outcome ? (
        <Loading />
      ) : !outcome.ok ? (
        <Notice
          tone="danger"
          title={t("copy.could-not-load-destinations-refresh-to-retry")}
        />
      ) : !current && candidates.length > 0 ? (
        <div className="space-y-4">
          <Notice
            tone="warning"
            title={t(
              "copy.the-previous-location-is-no-longer-available-select-another-destination-",
            )}
          />
          {picker}
        </div>
      ) : !current ? (
        <Panel className="space-y-3">
          <Notice
            title={t("copy.no-suitable-space-found")}
            body={t(
              "copy.the-pallet-remains-at-its-current-position-check-available-space-or-try-",
            )}
          />
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {outcome.value.reasons.map((reason) => (
              <li key={reason}>{recommendationReason(reason, tr)}</li>
            ))}
          </ul>
        </Panel>
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
      <CheckboxControl
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
  const { t, tr, locale } = useUnitText(
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
        t(
          "copy.this-code-does-not-identify-this-pallet-check-its-label-and-retry",
        ),
      );
      throw new Error("PALLET_MISMATCH");
    }
    op.setError("");
    setIdentified({ code, method });
  }
  return (
    <PageContainer actionInset="responsive">
      <Heading
        back={palletPath(detail.pallet._id)}
        backLabel={t("copy.back-to-pallet")}
        title={
          inTransit ? t("copy.confirm-pallet-move") : t("copy.move-prepared")
        }
      />
      <ol
        aria-label={t("copy.move-progress")}
        className="mb-5 flex flex-wrap items-center gap-3 text-sm"
      >
        {[
          t("copy.destination-selected"),
          inTransit ? t("copy.moving") : t("copy.awaiting-pickup"),
          t("copy.complete"),
        ].map((step, index) => (
          <li
            key={index}
            aria-current={index === 1 ? "step" : undefined}
            className={index === 1 ? "font-semibold text-link" : "text-muted"}
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
            title={t("copy.view-only-move")}
            body={t(
              "copy.only-the-operator-who-prepared-this-move-can-continue-it-other-operators",
            )}
          />
        </div>
      ) : null}
      <div className="mb-6 grid grid-cols-2 gap-5 text-sm">
        <div>
          <p className="text-xs text-muted">{t("copy.from")}</p>
          {move.sourceDestination?.locationCode !==
            move.targetDestination?.locationCode ||
          move.sourceDestination?.buildingCode !==
            move.targetDestination?.buildingCode ||
          move.sourceDestination?.floorNumber !==
            move.targetDestination?.floorNumber ? (
            <p className="mt-1 break-words">
              {move.sourceDestination
                ? `${move.sourceDestination.buildingCode} · ${t("copy.floor")} ${move.sourceDestination.floorNumber} · ${move.sourceDestination.locationName}`
                : t("copy.location-unavailable")}
            </p>
          ) : null}
          <p className="mt-1 font-mono text-sm">
            {move.sourcePlacement?.positionCode}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">{t("copy.to")}</p>
          {move.sourceDestination?.locationCode !==
            move.targetDestination?.locationCode ||
          move.sourceDestination?.buildingCode !==
            move.targetDestination?.buildingCode ||
          move.sourceDestination?.floorNumber !==
            move.targetDestination?.floorNumber ? (
            <p className="mt-1 break-words">
              {move.targetDestination
                ? `${move.targetDestination.buildingCode} · ${t("copy.floor")} ${move.targetDestination.floorNumber} · ${move.targetDestination.locationName}`
                : t("copy.location-unavailable")}
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
          <Panel as="section" className="order-1 min-w-0 space-y-4 md:order-2">
            <h2 className="text-lg leading-7 font-semibold">
              {inTransit
                ? t("copy.place-at-this-destination")
                : t("copy.pick-up-this-pallet")}
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
                <Notice tone="danger" title={t("copy.location-unavailable")} />
              )
            ) : move.sourceDestination &&
              move.sourcePlacement &&
              move.sourcePlacement.mode !== "LOCATION_ONLY" ? (
              <DestinationSummary
                destination={move.sourceDestination}
                placement={move.sourcePlacement}
              />
            ) : (
              <Notice tone="danger" title={t("copy.location-unavailable")} />
            )}
            <StickyActionBar placement="responsive" className="space-y-3">
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
                  ? t("copy.confirm-move-complete")
                  : t("copy.start-move")}
              </Button>
              <p className="text-sm text-muted" aria-live="polite">
                {inTransit
                  ? t("copy.confirming-releases-the-source-space")
                  : t("copy.tick-after-pickup-both-spaces-stay-reserved")}
              </p>
            </StickyActionBar>
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
                ? t("copy.use-checkbox-instead")
                : t("copy.scan-qr-optional")}
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
          </Panel>
        ) : null}
      </div>
      {issueSaved ? (
        <div className="mt-4">
          <Notice title={t("copy.issue-saved-both-spaces-remain-held")} />
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
                {t("copy.change-destination")}
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
              {inTransit ? t("copy.return-to-source") : t("copy.cancel-move")}
            </Button>
            <Button
              variant="outline"
              disabled={op.busy}
              onClick={() => {
                op.setError("");
                setDialog("issue");
              }}
            >
              {t("copy.report-an-issue")}
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
        <DialogContent closeLabel={t("copy.close")}>
          <DialogHeader>
            <DialogTitle>
              {dialog === "cancel"
                ? t("copy.cancel-this-move")
                : dialog === "return"
                  ? t("copy.confirm-physical-return-to-source")
                  : t("copy.report-an-issue")}
            </DialogTitle>
            <DialogDescription>
              {dialog === "cancel"
                ? t(
                    "copy.only-the-destination-reservation-is-released-the-pallet-remains-stored-a",
                  )
                : t(
                    "copy.both-spaces-remain-held-until-the-physical-move-or-return-is-confirmed",
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
                  ? t("copy.use-checkbox-instead")
                  : t("copy.scan-source-qr-optional")}
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
                          t("copy.this-code-does-not-match-the-source"),
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
              label={t("copy.describe-the-issue")}
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
              {t("copy.close")}
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
                ? t("copy.cancel-move")
                : dialog === "return"
                  ? t("copy.confirm-returned")
                  : t("copy.save-issue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
