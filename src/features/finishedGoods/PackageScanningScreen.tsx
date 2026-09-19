"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { PackageScanCamera } from "./PackageScanCamera";
import { ScannedPackageList } from "./ScannedPackageList";
import { ScanGroupDetails } from "./ScanGroupDetails";
import {
  assignmentSnapshot,
  canScanLocation,
  initialScanSession,
  scanReducer,
  type ScanEvent,
} from "./scanSession";
import {
  ErrorNotice,
  Field,
  FG_PATH,
  Loading,
  panel,
  palletPath,
  useCanManage,
  useDraftKey,
  useFGText,
  useOperation,
  useUnsavedWarning,
  ViewOnlyNotice,
  written,
} from "./shared";
export function PackageScanningScreen() {
  const scope = useDraftKey("fg-scan");
  if (!scope) return <Loading />;
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <ScanWorkflow
          key={`${scope}:${warehouseId}`}
          warehouseId={warehouseId}
        />
      )}
    </QueryGate>
  );
}
function ScanWorkflow({ warehouseId }: { warehouseId: string }) {
  const { tr } = useFGText();
  const canManage = useCanManage();
  const locationHintId = useId();
  const router = useRouter();
  const convex = useConvex();
  const confirm = useMutation(fgRefs.confirmScanAssignment);
  const operation = useOperation();
  const [state, setState] = useState(initialScanSession);
  const latest = useRef(state);
  const alive = useRef(true);
  const locationPending = useRef(false);
  const frozen = useRef<ReturnType<typeof assignmentSnapshot> | null>(null);
  const [retryLocked, setRetryLocked] = useState(false);
  const [manual, setManual] = useState("");
  const [feedback, setFeedback] = useState<{
    kind: "success" | "duplicate" | "error";
    message: string;
    code?: string;
  }>();
  const send = (event: ScanEvent) => {
    const next = scanReducer(latest.current, event);
    latest.current = next;
    setState(next);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(undefined), 1200);
    return () => clearTimeout(timer);
  }, [feedback]);
  useUnsavedWarning(state.rows.length > 0 && state.mode !== "COMPLETED");
  const scanError = (code: string) =>
    ({
      LOCATION_HAS_ACTIVE_RESERVATIONS: tr(
        "This location has a reserved placement or move destination. Finish or cancel it before scanning packages here.",
        "จุดนี้มีการจองจัดเก็บหรือปลายทางย้าย กรุณาดำเนินการให้เสร็จหรือยกเลิกก่อนสแกนพัสดุที่นี่",
      ),
      WRONG_ENTITY_TYPE: tr(
        "This label belongs to a different kind of record. Scan a package in package mode or a location in location mode.",
        "ป้ายนี้เป็นข้อมูลคนละประเภท กรุณาสแกนพัสดุหรือจุดจัดเก็บให้ตรงกับขั้นตอน",
      ),
      INVALID_IDENTITY: tr(
        "This label is not a supported package or location identity.",
        "ป้ายนี้ไม่ใช่รหัสพัสดุหรือจุดจัดเก็บที่รองรับ",
      ),
      AMBIGUOUS_IDENTITY: tr(
        "More than one record uses this code. Scan its unique QR label.",
        "มีหลายรายการใช้รหัสนี้ กรุณาสแกนป้าย QR เฉพาะรายการ",
      ),
      LOCATION_CHANGED: tr(
        "The location changed. Go back and scan its current label again.",
        "จุดจัดเก็บเปลี่ยนแล้ว กรุณากลับไปสแกนป้ายปัจจุบันอีกครั้ง",
      ),
      UNIT_CHANGED: tr(
        "A package changed. Go back, remove it and scan it again.",
        "พัสดุเปลี่ยนแล้ว กรุณากลับไปลบและสแกนใหม่",
      ),
      STORAGE_CONDITION_MISMATCH: tr(
        "This location does not meet the packages’ storage requirements. Choose another location.",
        "จุดนี้ไม่ตรงกับเงื่อนไขจัดเก็บพัสดุ กรุณาเลือกจุดอื่น",
      ),
      UNIT_UNAVAILABLE: tr(
        "This package is already stored, reserved, moving or unavailable. Remove it and scan an eligible package.",
        "พัสดุนี้ไม่พร้อมจัดเก็บ ลบแล้วสแกนพัสดุที่พร้อม",
      ),
      NOT_FOUND: tr(
        "Code not found in this warehouse. Check the label, remove this row and scan again.",
        "ไม่พบรหัสในคลังนี้ ตรวจสอบป้าย ลบรายการ แล้วสแกนใหม่",
      ),
      LOCATION_UNAVAILABLE: tr(
        "This location is unavailable. Scan an active location.",
        "จุดจัดเก็บนี้ไม่พร้อมใช้งาน กรุณาสแกนจุดที่เปิดใช้งาน",
      ),
    })[code] ??
    tr(
      "Code could not be verified. Check the label and connection, then remove and scan again.",
      "ตรวจสอบรหัสไม่ได้ ตรวจป้ายและการเชื่อมต่อ แล้วลบและสแกนใหม่",
    );
  async function onCode(code: string, method: "SCAN" | "MANUAL" = "SCAN") {
    code = code.trim();
    if (!code || !canManage || !alive.current) return;
    const current = latest.current;
    const generation = current.generation;
    if (current.mode === "PACKAGES") {
      if (current.rows.some((row) => row.code === code)) {
        setFeedback({
          kind: "duplicate",
          message: tr("Package already scanned", "สแกนพัสดุนี้แล้ว"),
          code:
            current.rows.find((row) => row.code === code)?.unit?.code ?? code,
        });
        return;
      }
      if (current.rows.length >= 50) {
        setFeedback({
          kind: "error",
          message: tr(
            "Maximum 50 packages per group",
            "สูงสุด 50 พัสดุต่อกลุ่ม",
          ),
        });
        return;
      }
      const key = crypto.randomUUID();
      send({ type: "add", key, code });
      try {
        const outcome = await convex.query(fgRefs.resolvePackageCode, {
          warehouseId,
          code,
        });
        if (
          !alive.current ||
          latest.current.generation !== generation ||
          !latest.current.rows.some((row) => row.key === key)
        )
          return;
        if (!outcome.ok) throw new Error("ACCESS_DENIED");
        if (!outcome.value.ok) throw new Error(outcome.value.error.code);
        const unit = outcome.value.unit;
        const duplicate = latest.current.rows.some(
          (row) => row.unit?.id === unit.id,
        );
        send({ type: "resolve", key, generation, unit });
        setFeedback({
          kind: duplicate ? "duplicate" : "success",
          message: duplicate
            ? tr("Package already scanned", "สแกนพัสดุนี้แล้ว")
            : tr("Package added", "เพิ่มพัสดุแล้ว"),
          code: unit.code,
        });
      } catch (error) {
        if (alive.current)
          send({
            type: "error",
            key,
            generation,
            error: scanError(error instanceof Error ? error.message : ""),
          });
      }
    } else if (
      current.mode === "LOCATION_SCANNING" &&
      !locationPending.current
    ) {
      locationPending.current = true;
      try {
        const outcome = await convex.query(fgRefs.resolveLocationCode, {
          warehouseId,
          code,
        });
        if (!alive.current || latest.current.generation !== generation) return;
        if (!outcome.ok) throw new Error("ACCESS_DENIED");
        if (!outcome.value.ok) throw new Error(outcome.value.error.code);
        send({
          type: "detected",
          generation,
          location: { ...outcome.value.location, rawCode: code, method },
        });
      } catch (error) {
        if (alive.current && latest.current.generation === generation)
          setFeedback({
            kind: "error",
            message: scanError(error instanceof Error ? error.message : ""),
          });
      } finally {
        locationPending.current = false;
      }
    }
  }
  async function submit() {
    if (latest.current.mode !== "LOCATION_DETECTED") return;
    frozen.current ??= assignmentSnapshot(
      latest.current,
      warehouseId,
      crypto.randomUUID(),
    );
    setRetryLocked(true);
    send({ type: "submit" });
    const result = await operation.run(async () => {
      const outcome = await confirm(frozen.current!);
      // An explicit rejection made no assignment; only ambiguous network failures retain the frozen request.
      if (!outcome.ok || !outcome.value.written) {
        frozen.current = null;
        setRetryLocked(false);
      }
      if (outcome.ok && !outcome.value.written && outcome.value.error) {
        operation.setError(scanError(outcome.value.error.code));
        return null;
      }
      return written(outcome);
    });
    if (!alive.current) return;
    send({ type: result !== null ? "complete" : "failed" });
  }
  const back = () => {
    if (frozen.current) return;
    if (latest.current.mode !== "PACKAGES") {
      send({ type: "back" });
      return;
    }
    if (
      !latest.current.rows.length ||
      window.confirm(
        tr(
          "Leave and discard this unsaved scan group?",
          "ออกและทิ้งกลุ่มสแกนที่ยังไม่บันทึกหรือไม่?",
        ),
      )
    )
      router.push(FG_PATH);
  };
  if (!canManage) return <ViewOnlyNotice />;
  if (state.mode === "COMPLETED")
    return (
      <div className="space-y-5">
        <section className={panel}>
          <h1 className="text-2xl font-semibold">
            {tr("Packages assigned", "จัดเก็บพัสดุแล้ว")}
          </h1>
          <p>
            {state.rows.length} {tr("packages at", "พัสดุที่")}{" "}
            {state.location?.name} · {state.location?.code}
          </p>
        </section>
        <ScannedPackageList state={state} dispatch={send} readOnly />
        {state.rows[0]?.unit && (
          <Button asChild variant="outline">
            <Link href={palletPath(state.rows[0].unit.id)}>
              {tr("View saved assignment", "ดูรายการจัดเก็บที่บันทึก")}
            </Link>
          </Button>
        )}
        <Button asChild>
          <Link href={FG_PATH}>
            {tr("Back to finished goods", "กลับรายการสินค้าสำเร็จรูป")}
          </Link>
        </Button>
      </div>
    );
  const packages = state.mode === "PACKAGES";
  const detected =
    state.mode === "LOCATION_DETECTED" || state.mode === "SUBMITTING";
  const locationBlocker = !state.rows.length
    ? tr(
        "Scan at least one registered package to continue.",
        "สแกนพัสดุที่ลงทะเบียนอย่างน้อยหนึ่งชิ้นเพื่อดำเนินการต่อ",
      )
    : state.rows.some((row) => row.status === "error")
      ? tr(
          "Remove the unrecognized or unavailable packages above to continue.",
          "ลบพัสดุที่ไม่พบหรือไม่พร้อมจัดเก็บด้านบนเพื่อดำเนินการต่อ",
        )
      : state.rows.some((row) => row.status === "pending")
        ? tr(
            "Checking packages. Please wait…",
            "กำลังตรวจสอบพัสดุ กรุณารอสักครู่…",
          )
        : !canScanLocation(state)
          ? tr(
              "Enter a fullness percentage from 1 to 100 for every package.",
              "ระบุความเต็มของพัสดุทุกชิ้นเป็นเปอร์เซ็นต์ตั้งแต่ 1 ถึง 100",
            )
          : null;
  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-40">
      <PackageScanCamera
        mode={packages ? "PACKAGES" : "LOCATION"}
        active={packages || state.mode === "LOCATION_SCANNING"}
        count={state.rows.filter((row) => row.status === "ready").length}
        onCode={(code) => {
          if (latest.current.generation !== state.generation) return;
          void onCode(code);
        }}
        onBack={back}
        {...(feedback ? { feedback } : {})}
      />
      <ErrorNotice message={operation.error} />
      {(packages || state.mode === "LOCATION_SCANNING") && (
        <form
          className={`${panel} space-y-3`}
          onSubmit={(event) => {
            event.preventDefault();
            void onCode(manual, "MANUAL");
            setManual("");
          }}
        >
          <Field
            label={tr(
              "Manual / handheld code verification",
              "ตรวจสอบรหัสด้วยการกรอก / เครื่องสแกนมือถือ",
            )}
            value={manual}
            onChange={setManual}
          />
          <p className="text-xs text-muted">
            {tr(
              "Recorded as MANUAL verification.",
              "บันทึกเป็นการตรวจสอบด้วยตนเอง (MANUAL)",
            )}
          </p>
          <Button
            type="submit"
            variant="outline"
            disabled={!manual.trim()}
            className="min-h-11"
          >
            {tr("Check code", "ตรวจสอบรหัส")}
          </Button>
        </form>
      )}
      {detected && (
        <section className={`${panel} space-y-2`}>
          <h1 className="text-2xl font-semibold">
            {tr("Location detected", "ตรวจพบจุดจัดเก็บ")}
          </h1>
          <p className="text-lg font-semibold">
            {state.location?.name} · {state.location?.code}
          </p>
          <p>
            {state.rows.length}{" "}
            {tr(
              "packages will be assigned in this top-to-bottom order.",
              "พัสดุจะจัดเก็บตามลำดับจากบนลงล่างนี้",
            )}
          </p>
          <p>
            {tr("Similar size:", "ขนาดใกล้เคียง:")}{" "}
            {state.sameSize ? tr("Yes", "ใช่") : tr("No", "ไม่ใช่")}
          </p>
          <p className="text-sm text-muted">
            {tr(
              "Confirm only after physically placing this group at the detected location.",
              "ยืนยันหลังจากนำกลุ่มพัสดุไปวางที่จุดจัดเก็บนี้จริงแล้วเท่านั้น",
            )}
          </p>
        </section>
      )}
      <div>
        <h2 className="mb-3 text-lg font-semibold">
          {tr("Top → Bottom", "บนสุด → ล่างสุด")} · {state.rows.length}/50
        </h2>
        {!state.rows.length && (
          <p className={`${panel} text-muted`}>
            {tr("Scan the first package to start.", "สแกนพัสดุแรกเพื่อเริ่ม")}
          </p>
        )}
        <ScannedPackageList
          state={state}
          dispatch={send}
          readOnly={!packages}
        />
      </div>
      {packages && <ScanGroupDetails state={state} dispatch={send} />}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface p-4">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-3">
          {packages ? (
            <Button
              className="min-h-12 flex-1"
              disabled={!canScanLocation(state)}
              aria-describedby={locationBlocker ? locationHintId : undefined}
              onClick={() => send({ type: "location" })}
            >
              {tr("Scan Location", "สแกนจุดจัดเก็บ")}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="min-h-12"
                disabled={state.mode === "SUBMITTING" || retryLocked}
                onClick={back}
              >
                {tr("Back to packages", "กลับรายการพัสดุ")}
              </Button>
              {detected && (
                <>
                  <Button
                    variant="outline"
                    className="min-h-12"
                    disabled={state.mode === "SUBMITTING" || retryLocked}
                    onClick={() => send({ type: "rescan" })}
                  >
                    {tr("Rescan location", "สแกนจุดใหม่")}
                  </Button>
                  <Button
                    className="min-h-12 flex-1"
                    disabled={state.mode === "SUBMITTING"}
                    onClick={() => {
                      void submit();
                    }}
                  >
                    {state.mode === "SUBMITTING"
                      ? tr("Saving…", "กำลังบันทึก…")
                      : retryLocked
                        ? tr(
                            "Retry same assignment",
                            "ลองบันทึกรายการเดิมอีกครั้ง",
                          )
                        : tr("Confirm Location", "ยืนยันจุดจัดเก็บ")}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
        {packages && locationBlocker && (
          <p
            id={locationHintId}
            role="status"
            className="mx-auto mt-2 max-w-3xl text-sm text-muted"
          >
            {locationBlocker}
          </p>
        )}
        {retryLocked && state.mode === "LOCATION_DETECTED" && (
          <p className="mx-auto mt-2 max-w-3xl text-xs text-muted">
            {tr(
              "The result may be uncertain. Retry keeps the same group and request to avoid duplicate storage.",
              "ผลการบันทึกอาจยังไม่แน่นอน การลองใหม่ใช้รายการเดิมเพื่อป้องกันบันทึกซ้ำ",
            )}
          </p>
        )}
      </div>
    </div>
  );
}
