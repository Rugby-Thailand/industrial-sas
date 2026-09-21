"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/Panel";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { PageContainer } from "@/components/ui/PageContainer";
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
  const { t } = useFGText();
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
      LOCATION_HAS_ACTIVE_RESERVATIONS: t(
        "copy.this-location-has-a-reserved-placement-or-move-destination-finish-or-can",
      ),
      WRONG_ENTITY_TYPE: t(
        "copy.this-label-belongs-to-a-different-kind-of-record-scan-a-package-in-packa",
      ),
      INVALID_IDENTITY: t(
        "copy.this-label-is-not-a-supported-package-or-location-identity",
      ),
      AMBIGUOUS_IDENTITY: t(
        "copy.more-than-one-record-uses-this-code-scan-its-unique-qr-label",
      ),
      LOCATION_CHANGED: t(
        "copy.the-location-changed-go-back-and-scan-its-current-label-again",
      ),
      UNIT_CHANGED: t(
        "copy.a-package-changed-go-back-remove-it-and-scan-it-again",
      ),
      STORAGE_CONDITION_MISMATCH: t(
        "copy.this-location-does-not-meet-the-packages-storage-requirements-choose-ano",
      ),
      UNIT_UNAVAILABLE: t(
        "copy.this-package-is-already-stored-reserved-moving-or-unavailable-remove-it-",
      ),
      NOT_FOUND: t(
        "copy.code-not-found-in-this-warehouse-check-the-label-remove-this-row-and-sca",
      ),
      LOCATION_UNAVAILABLE: t(
        "copy.this-location-is-unavailable-scan-an-active-location",
      ),
    })[code] ??
    t(
      "copy.code-could-not-be-verified-check-the-label-and-connection-then-remove-an",
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
          message: t("copy.package-already-scanned"),
          code:
            current.rows.find((row) => row.code === code)?.unit?.code ?? code,
        });
        return;
      }
      if (current.rows.length >= 50) {
        setFeedback({
          kind: "error",
          message: t("copy.maximum-50-packages-per-group"),
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
            ? t("copy.package-already-scanned")
            : t("copy.package-added"),
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
      window.confirm(t("copy.leave-and-discard-this-unsaved-scan-group"))
    )
      router.push(FG_PATH);
  };
  if (!canManage) return <ViewOnlyNotice />;
  if (state.mode === "COMPLETED")
    return (
      <div className="space-y-5">
        <Panel>
          <h1 className="text-2xl font-semibold">
            {t("copy.packages-assigned")}
          </h1>
          <p>
            {state.rows.length} {t("copy.packages-at")} {state.location?.name} ·{" "}
            {state.location?.code}
          </p>
        </Panel>
        <ScannedPackageList state={state} dispatch={send} readOnly />
        {state.rows[0]?.unit && (
          <Button asChild variant="outline">
            <Link href={palletPath(state.rows[0].unit.id)}>
              {t("copy.view-saved-assignment")}
            </Link>
          </Button>
        )}
        <Button asChild>
          <Link href={FG_PATH}>{t("copy.back-to-finished-goods")}</Link>
        </Button>
      </div>
    );
  const packages = state.mode === "PACKAGES";
  const detected =
    state.mode === "LOCATION_DETECTED" || state.mode === "SUBMITTING";
  const locationBlocker = !state.rows.length
    ? t("copy.scan-at-least-one-registered-package-to-continue")
    : state.rows.some((row) => row.status === "error")
      ? t(
          "copy.remove-the-unrecognized-or-unavailable-packages-above-to-continue",
        )
      : state.rows.some((row) => row.status === "pending")
        ? t("copy.checking-packages-please-wait")
        : !canScanLocation(state)
          ? t(
              "copy.enter-a-fullness-percentage-from-1-to-100-for-every-package",
            )
          : null;
  return (
    <PageContainer size="form" actionInset="fixed">
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
        <Panel
          as="form"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onCode(manual, "MANUAL");
            setManual("");
          }}
        >
          <Field
            label={t("copy.manual-handheld-code-verification")}
            value={manual}
            onChange={setManual}
          />
          <p className="text-xs text-muted">
            {t("copy.recorded-as-manual-verification")}
          </p>
          <Button
            type="submit"
            variant="outline"
            disabled={!manual.trim()}
            className="min-h-11"
          >
            {t("copy.check-code")}
          </Button>
        </Panel>
      )}
      {detected && (
        <Panel className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("copy.location-detected")}
          </h1>
          <p className="text-lg font-semibold">
            {state.location?.name} · {state.location?.code}
          </p>
          <p>
            {state.rows.length}{" "}
            {t("copy.packages-will-be-assigned-in-this-top-to-bottom-order")}
          </p>
          <p>
            {t("copy.similar-size")}{" "}
            {state.sameSize ? t("copy.yes") : t("copy.no")}
          </p>
          <p className="text-sm text-muted">
            {t(
              "copy.confirm-only-after-physically-placing-this-group-at-the-detected-locatio",
            )}
          </p>
        </Panel>
      )}
      <div>
        <h2 className="mb-3 text-lg leading-7 font-semibold">
          {t("copy.top-bottom")} · {state.rows.length}/50
        </h2>
        {!state.rows.length && (
          <Panel as="p" className="text-muted">
            {t("copy.scan-the-first-package-to-start")}
          </Panel>
        )}
        <ScannedPackageList
          state={state}
          dispatch={send}
          readOnly={!packages}
        />
      </div>
      {packages && <ScanGroupDetails state={state} dispatch={send} />}
      <StickyActionBar placement="fixed">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-3">
          {packages ? (
            <Button
              className="min-h-12 flex-1"
              disabled={!canScanLocation(state)}
              aria-describedby={locationBlocker ? locationHintId : undefined}
              onClick={() => send({ type: "location" })}
            >
              {t("copy.scan-location")}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="min-h-12"
                disabled={state.mode === "SUBMITTING" || retryLocked}
                onClick={back}
              >
                {t("copy.back-to-packages")}
              </Button>
              {detected && (
                <>
                  <Button
                    variant="outline"
                    className="min-h-12"
                    disabled={state.mode === "SUBMITTING" || retryLocked}
                    onClick={() => send({ type: "rescan" })}
                  >
                    {t("copy.rescan-location")}
                  </Button>
                  <Button
                    className="min-h-12 flex-1"
                    disabled={state.mode === "SUBMITTING"}
                    onClick={() => {
                      void submit();
                    }}
                  >
                    {state.mode === "SUBMITTING"
                      ? t("copy.saving")
                      : retryLocked
                        ? t("copy.retry-same-assignment")
                        : t("copy.confirm-location")}
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
            {t(
              "copy.the-result-may-be-uncertain-retry-keeps-the-same-group-and-request-to-av",
            )}
          </p>
        )}
      </StickyActionBar>
    </PageContainer>
  );
}
