"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Layers3, RotateCw, LockKeyhole, CheckCircle2 } from "lucide-react";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { SelectControl } from "@/components/ui/SelectControl";
import { Link, useRouter } from "@/i18n/navigation";
import { fgRefs, type Pallet } from "@/lib/convex/finishedGoodsApi";
import { PalletScene } from "./PalletScene";
import {
  ErrorNotice,
  Field,
  Heading,
  Loading,
  Missing,
  panel,
  palletPath,
  useCanManage,
  useFGText,
  useOperation,
  written,
  errorText,
  useDraftKey,
} from "./shared";

export function StackScreen({ palletId }: { palletId: string }) {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <StackLoader
          key={`${warehouseId}:${palletId}`}
          warehouseId={warehouseId}
          palletId={palletId}
        />
      )}
    </QueryGate>
  );
}
function Limits({
  pallet,
  warehouseId,
  locked = false,
  onDirty,
}: {
  pallet: Pallet;
  warehouseId: string;
  locked?: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const { tr } = useFGText();
  const canManage = useCanManage();
  const save = useMutation(fgRefs.saveStackingLimits);
  const op = useOperation(`${warehouseId}:${pallet._id}:stacking-limits`);
  const [stackable, setStackable] = useState(pallet.stackable ?? false);
  const [levels, setLevels] = useState(String(pallet.maxStackLevels ?? ""));
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const args = {
          warehouseId,
          palletId: pallet._id,
          stackable,
          ...(stackable ? { maxStackLevels: Number(levels) } : {}),
        };
        void op.run(async () => {
          written(
            await save({
              ...args,
              requestId: op.request(JSON.stringify(args)),
            }),
          );
          setSaved(true);
          onDirty(false);
          op.clearRequests();
        });
      }}
    >
      <fieldset
        disabled={locked || !canManage || op.busy}
        className="space-y-3"
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={stackable}
            onChange={(e) => {
              setStackable(e.target.checked);
              setSaved(false);
              onDirty(true);
            }}
          />
          {tr("May support another pallet", "อนุญาตให้วางพาเลทซ้อนด้านบน")}
        </label>
        {stackable ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={tr(
                "Maximum levels, including this pallet",
                "จำนวนชั้นสูงสุด รวมพาเลทนี้",
              )}
              type="number"
              required
              min={2}
              max={10}
              step="1"
              value={levels}
              onChange={(v) => {
                setLevels(v);
                setSaved(false);
                onDirty(true);
              }}
            />
          </div>
        ) : null}
        {!locked && canManage ? (
          <Button type="submit" variant="outline">
            {saved
              ? tr("Limits saved", "บันทึกข้อกำหนดแล้ว")
              : tr("Save stacking limits", "บันทึกข้อกำหนดการซ้อน")}
          </Button>
        ) : null}
      </fieldset>
      <ErrorNotice message={op.error} />
    </form>
  );
}
function StackLoader({
  warehouseId,
  palletId,
}: {
  warehouseId: string;
  palletId: string;
}) {
  const { tr, locale } = useFGText();
  const router = useRouter();
  const canManage = useCanManage();
  const scope = useDraftKey("stack");
  const op = useOperation(
    scope ? `${scope}:${warehouseId}:${palletId}` : undefined,
  );
  const [upperId, setUpperId] = useState("");
  const [lowerDirty, setLowerDirty] = useState(false);
  const [upperDirty, setUpperDirty] = useState(false);
  const [rotation, setRotation] = useState<0 | 90>(0);
  const result = useQuery(fgRefs.stackOptions, {
    warehouseId,
    palletId,
    rotation,
    ...(upperId ? { upperPalletId: upperId } : {}),
  });
  const reserve = useMutation(fgRefs.reserve);
  const reserveMove = useMutation(fgRefs.reserveMove);
  if (!result) return <Loading />;
  if (!result.ok || !result.value) return <Missing />;
  const {
    lower,
    pallets,
    candidate,
    error,
    children,
    lowerSettingsLocked,
    upperSettingsLocked,
  } = result.value;
  const upper = pallets.find((p) => p._id === upperId);
  const supportLocked =
    Boolean(lower.placementId && children.length) ||
    Boolean(lower.status === "RESERVED");
  async function prepare() {
    if (!candidate || !upper || error || lowerDirty || upperDirty) return;
    await op.run(async () => {
      const args = {
        warehouseId,
        palletId: upper._id,
        zoneId: candidate.zoneId,
        supportPalletId: palletId,
        xMm: candidate.xMm,
        yMm: candidate.yMm,
        rotation,
        expectedMeasurementUpdatedAt: upper.updatedAt,
      };
      if (upper.status === "STORED" && upper.placementId) {
        const moveArgs = {
          ...args,
          expectedSourcePlacementId: upper.placementId,
        };
        written(
          await reserveMove({
            ...moveArgs,
            requestId: op.request(JSON.stringify(moveArgs)),
          }),
        );
        router.push(`${palletPath(upper._id)}/move`);
      } else {
        written(
          await reserve({
            ...args,
            requestId: op.request(JSON.stringify(args)),
          }),
        );
        router.push(palletPath(upper._id));
      }
      op.clearRequests();
    });
  }
  return (
    <div className="space-y-5">
      <Heading
        back={palletPath(palletId)}
        backLabel={tr("Back to pallet", "กลับไปพาเลท")}
        title={tr("Stack on top", "ซ้อนพาเลทด้านบน")}
        description={tr(
          "Choose support → Preview and check → Verify physical placement",
          "เลือกพาเลทรองรับ → ตรวจสอบภาพตัวอย่าง → ยืนยันการวางจริง",
        )}
      />
      <div className="grid items-start gap-5 xl:grid-cols-[1.35fr_1fr]">
        <section className={`${panel} space-y-4`}>
          <h2 className="flex items-center gap-2 font-semibold">
            <Layers3 className="size-5" />
            {tr("Preview and check", "ภาพตัวอย่างและการตรวจสอบ")}
          </h2>
          {candidate && upper ? (
            <>
              <PalletScene
                locale={locale}
                label={upper.code}
                dimensions={{
                  widthMm: upper.widthMm ?? 0,
                  depthMm: upper.lengthMm ?? 0,
                  heightMm: upper.heightMm ?? 0,
                }}
                area={{
                  widthMm: candidate.zone.widthMm,
                  depthMm: candidate.zone.depthMm,
                  heightMm:
                    candidate.zone.maxStackHeightMm +
                    candidate.zone.baseElevationMm,
                }}
                support={candidate.support}
                placement={{
                  xMm: candidate.xMm,
                  yMm: candidate.yMm,
                  zMm: candidate.zMm,
                  rotation,
                }}
                occupied={candidate.occupied.map((p) => ({
                  ...p,
                  id: p.placementId,
                  label: p.palletId === lower._id ? lower.code : p.positionCode,
                }))}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <LockKeyhole className="size-4" />Z{" "}
                  {(candidate.zMm / 1000).toFixed(2)} m ·{" "}
                  {tr("Automatic height", "ระดับสูงอัตโนมัติ")}
                </span>
                <Button
                  variant="outline"
                  disabled={lowerDirty || upperDirty || op.busy}
                  onClick={() => setRotation(rotation === 0 ? 90 : 0)}
                >
                  <RotateCw className="size-4" />
                  90°
                </Button>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted">
                    {tr(
                      "Top elevation / available ceiling",
                      "ระดับบนสุด / เพดานที่ใช้ได้",
                    )}
                  </dt>
                  <dd>
                    {(candidate.zMm + candidate.heightMm) / 1000} /{" "}
                    {(candidate.support.zMm + candidate.support.heightMm) /
                      1000}{" "}
                    m
                  </dd>
                </div>
              </dl>
              {!error ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="size-4" />
                  {tr(
                    "Footprint, height, collision and stack-level checks pass.",
                    "ผ่านการตรวจสอบขนาด ความสูง การทับซ้อน และจำนวนชั้น",
                  )}
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-muted">
              {tr(
                "Choose an upper pallet to preview its exact position.",
                "เลือกพาเลทด้านบนเพื่อดูตำแหน่งที่แน่นอน",
              )}
            </div>
          )}
          <ErrorNotice
            message={
              error === "OUTSIDE_LOCATION"
                ? tr(
                    "The upper pallet extends beyond the supporting pallet.",
                    "พาเลทด้านบนยื่นออกนอกขอบพาเลทรองรับ",
                  )
                : error
                  ? errorText(error, tr)
                  : ""
            }
          />
          <p className="text-xs text-muted">
            {tr(
              "One pallet per level. Weight and load checks are not enabled in this version.",
              "หนึ่งพาเลทต่อชั้น เวอร์ชันนี้ยังไม่ตรวจสอบน้ำหนักและการรับน้ำหนัก",
            )}
          </p>
        </section>
        <div className="space-y-4">
          <section className={`${panel} space-y-4`}>
            <h2 className="font-semibold">
              1. {tr("Support", "พาเลทรองรับ")} ·{" "}
              <Link
                className="text-primary underline"
                href={palletPath(lower._id)}
              >
                {lower.code}
              </Link>
            </h2>
            <Limits
              key={lower._id}
              warehouseId={warehouseId}
              pallet={lower}
              onDirty={setLowerDirty}
              locked={supportLocked || lowerSettingsLocked}
            />
            {children.length ? (
              <p className="text-sm text-muted">
                {tr(
                  "This support is occupied or reserved. Open the upper pallet to move it or cancel its reservation.",
                  "ด้านบนถูกใช้งานหรือจองแล้ว เปิดพาเลทด้านบนเพื่อย้ายหรือยกเลิกการจอง",
                )}
              </p>
            ) : null}
            {children.map((p) => (
              <Link
                key={p._id}
                className="block text-sm text-primary underline"
                href={palletPath(p.palletId)}
              >
                {tr("Open upper pallet", "เปิดพาเลทด้านบน")} · {p.positionCode}
              </Link>
            ))}
          </section>
          <section className={`${panel} space-y-4`}>
            <div className="block space-y-2 text-sm">
              <span className="font-semibold">
                2. {tr("Upper pallet", "พาเลทด้านบน")}
              </span>
              <SelectControl
                label={`2. ${tr("Upper pallet", "พาเลทด้านบน")}`}
                disabled={lowerDirty || upperDirty || op.busy}
                value={upperId}
                onValueChange={(nextUpperId) => {
                  setUpperId(nextUpperId);
                  setUpperDirty(false);
                  op.setError("");
                }}
                options={[
                  {
                    value: "",
                    label: tr(
                      "Choose a measured pallet",
                      "เลือกพาเลทที่วัดขนาดแล้ว",
                    ),
                  },
                  ...pallets.map((p) => ({
                    value: p._id,
                    label: `${p.code} · ${p.quantity} · ${
                      p.status === "STORED"
                        ? tr(
                            "Stored — move to stack",
                            "จัดเก็บแล้ว — ย้ายไปซ้อน",
                          )
                        : tr("Awaiting storage", "รอจัดเก็บ")
                    }`,
                  })),
                ]}
                placeholder={tr(
                  "Choose a measured pallet",
                  "เลือกพาเลทที่วัดขนาดแล้ว",
                )}
                emptyLabel={tr(
                  "No measured pallets available",
                  "ไม่มีพาเลทที่วัดขนาดแล้ว",
                )}
              />
            </div>
            {!pallets.length ? (
              <p className="text-sm text-muted">
                {tr(
                  "No measured pallets are available. Create and measure a pallet first.",
                  "ไม่มีพาเลทที่วัดขนาดแล้ว กรุณาสร้างและวัดขนาดพาเลทก่อน",
                )}
              </p>
            ) : null}
            {upper ? (
              <Limits
                key={upper._id}
                pallet={upper}
                onDirty={setUpperDirty}
                warehouseId={warehouseId}
                locked={upper.status === "RESERVED" || upperSettingsLocked}
              />
            ) : null}
          </section>
        </div>
      </div>
      {lowerDirty || upperDirty ? (
        <p role="status" className="text-sm text-muted">
          {tr(
            "Save the edited stacking limits before reserving.",
            "บันทึกข้อกำหนดการซ้อนที่แก้ไขก่อนจองตำแหน่ง",
          )}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ErrorNotice message={op.error} />
        <Button
          disabled={
            !canManage ||
            !candidate ||
            Boolean(error) ||
            op.busy ||
            lowerDirty ||
            upperDirty
          }
          onClick={() => void prepare()}
        >
          {upper?.status === "STORED"
            ? tr(
                "Reserve stack and prepare move",
                "จองตำแหน่งซ้อนและเตรียมย้าย",
              )
            : tr("Reserve stack and verify", "จองตำแหน่งซ้อนและตรวจสอบ")}
        </Button>
      </div>
    </div>
  );
}
