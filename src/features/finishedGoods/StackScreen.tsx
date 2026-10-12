"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CursorPagination } from "@/components/system/CursorPagination";
import { Input } from "@/components/ui/input";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useDebouncedSearch } from "@/hooks/useScanContinuation";
import { useScanRecovery } from "@/hooks/useScanRecovery";
import { Layers3, RotateCw, LockKeyhole, CheckCircle2 } from "lucide-react";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/button";
import { SelectControl } from "@/components/ui/SelectControl";
import { Link, useRouter } from "@/i18n/navigation";
import { fgRefs, type Pallet } from "@/lib/convex/finishedGoodsApi";
import { PalletScene } from "./PalletScene";
import {
  ErrorNotice,
  Field,
  Heading,
  usePalletTrail,
  Loading,
  Missing,
  panel,
  palletPath,
  useCanManage,
  useFGText,
  useOperation,
  written,
  useWriteError,
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
  const { t } = useFGText();
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
        void op.run(
          async () => {
            written(
              await save({
                ...args,
                requestId: op.request(JSON.stringify(args)),
              }),
            );
          },
          () => {
            setSaved(true);
            onDirty(false);
            op.clearRequests();
          },
        );
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
          {t("copy.may-support-another-pallet")}
        </label>
        {stackable ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t("copy.maximum-levels-including-this-pallet")}
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
            {saved ? t("copy.limits-saved") : t("copy.save-stacking-limits")}
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
  const { t, locale } = useFGText();
  const writeError = useWriteError();
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
  const detail = useQuery(fgRefs.getPallet, {
    warehouseId,
    palletId,
    includeMoveHistory: false,
  });
  const crumbs = usePalletTrail(detail?.ok ? detail.value : undefined);
  const result = useQuery(fgRefs.stackPreview, {
    warehouseId,
    palletId,
    rotation,
    ...(upperId ? { upperPalletId: upperId } : {}),
  });
  const choices = useStackChoices(warehouseId, palletId);
  const reserve = useMutation(fgRefs.reserve);
  const reserveMove = useMutation(fgRefs.reserveMove);
  if (detail?.ok && detail.value?.placement?.mode === "LOCATION_ONLY")
    return (
      <>
        <Heading title={t("copy.stacking-unavailable")} breadcrumbs={crumbs} />
        <Notice
          title={t(
            "copy.this-unit-has-a-saved-location-without-measured-coordinates",
          )}
          body={t(
            "copy.the-saved-sequence-records-top-to-bottom-order-it-does-not-establish-a-m",
          )}
        />
      </>
    );
  if (!result) return <Loading />;
  if (!result.ok || !result.value) return <Missing />;
  const {
    lower,
    candidate,
    error,
    children,
    lowerSettingsLocked,
    upperSettingsLocked,
  } = result.value;
  const upper =
    result.value.upper && result.value.upper._id === upperId
      ? result.value.upper
      : undefined;
  // The chosen pallet stays selectable after paging or searching elsewhere.
  const options = [
    ...(upper && !choices.items.some((p) => p._id === upper._id)
      ? [upper]
      : []),
    ...choices.items,
  ];
  const supportLocked =
    Boolean(lower.placementId && children.length) ||
    Boolean(lower.status === "RESERVED");
  async function prepare() {
    if (!candidate || !upper || error || lowerDirty || upperDirty) return;
    await op.run(
      async () => {
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
          return `${palletPath(upper._id)}/move`;
        }
        written(
          await reserve({
            ...args,
            requestId: op.request(JSON.stringify(args)),
          }),
        );
        return palletPath(upper._id);
      },
      (destination) => {
        router.push(destination);
        op.clearRequests();
      },
    );
  }
  return (
    <div className="space-y-5">
      <Heading
        breadcrumbs={crumbs}
        title={t("copy.stack-on-top-c3ca8e")}
        description={t(
          "copy.choose-support-preview-and-check-verify-physical-placement",
        )}
      />
      <div className="grid items-start gap-4 xl:grid-cols-[1.35fr_1fr]">
        <section className={`${panel} space-y-4`}>
          <h2 className="flex items-center gap-2 text-lg leading-7 font-semibold">
            <Layers3 className="size-5" />
            {t("copy.preview-and-check")}
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
                  {t("copy.automatic-height")}
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
                    {t("copy.top-elevation-available-ceiling")}
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
                  {t(
                    "copy.footprint-height-collision-and-stack-level-checks-pass",
                  )}
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-muted">
              {t("copy.choose-an-upper-pallet-to-preview-its-exact-position")}
            </div>
          )}
          <ErrorNotice
            message={
              error === "OUTSIDE_LOCATION"
                ? t(
                    "copy.the-upper-pallet-extends-beyond-the-supporting-pallet",
                  )
                : error
                  ? writeError(error)
                  : ""
            }
          />
          <p className="text-xs text-muted">
            {t(
              "copy.one-pallet-per-level-weight-and-load-checks-are-not-enabled-in-this-vers",
            )}
          </p>
        </section>
        <div className="space-y-4">
          <section className={`${panel} space-y-4`}>
            <h2 className="text-lg leading-7 font-semibold">
              1. {t("copy.support-cb893d")} ·{" "}
              <Link
                className="text-link underline"
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
                {t(
                  "copy.this-support-is-occupied-or-reserved-open-the-upper-pallet-to-move-it-or",
                )}
              </p>
            ) : null}
            {children.map((p) => (
              <Link
                key={p._id}
                className="block text-sm text-link underline"
                href={palletPath(p.palletId)}
              >
                {t("copy.open-upper-pallet")} · {p.positionCode}
              </Link>
            ))}
          </section>
          <section className={`${panel} space-y-4`}>
            <div className="block space-y-2 text-sm">
              <span className="font-semibold">2. {t("copy.upper-pallet")}</span>
              <SelectControl
                label={`2. ${t("copy.upper-pallet")}`}
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
                    label: t("copy.choose-a-measured-pallet"),
                  },
                  ...options.map((p) => ({
                    value: p._id,
                    label: `${p.code} · ${p.quantity} · ${
                      p.status === "STORED"
                        ? t("copy.stored-move-to-stack")
                        : t("copy.awaiting-storage")
                    }`,
                  })),
                ]}
                placeholder={t("copy.choose-a-measured-pallet")}
                emptyLabel={t("copy.no-measured-pallets-available")}
              />
            </div>
            <StackChoiceControls
              choices={choices}
              disabled={lowerDirty || upperDirty || op.busy}
            />
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
          {t("copy.save-the-edited-stacking-limits-before-reserving")}
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
            ? t("copy.reserve-stack-and-prepare-move")
            : t("copy.reserve-stack-and-verify")}
        </Button>
      </div>
    </div>
  );
}

const hasChoiceRows = (value: object) =>
  "items" in value && Array.isArray(value.items) && value.items.length > 0;

/** Eligible upper pallets in server pages; selection is resolved by ID. */
function useStackChoices(warehouseId: string, palletId: string) {
  const [search, setSearch] = useState("");
  const typed = search.trim();
  const settled = useDebouncedSearch(typed);
  const paging = useCursorPagination({
    scope: `stack-choices:${warehouseId}:${palletId}`,
    criteria: { search: typed },
  });
  const requestKey = JSON.stringify([settled, paging.cursor, paging.pageSize]);
  const recovery = useScanRecovery(requestKey);
  const outcome = useQuery(
    fgRefs.stackChoices,
    typed === settled
      ? {
          warehouseId,
          palletId,
          ...(settled ? { search: settled } : {}),
          cursor: paging.cursor,
          pageSize: paging.pageSize,
          ...(recovery.cursor ? { scanCursor: recovery.cursor } : {}),
          ...(recovery.attempt ? { attempt: recovery.attempt } : {}),
        }
      : "skip",
  );
  const tracked = recovery.track(
    outcome === undefined
      ? undefined
      : outcome.ok && outcome.value
        ? { ok: true, value: outcome.value }
        : { ok: false },
  );
  useCatalogueSync({
    outcome: tracked.outcome,
    continuation: tracked.continuation,
    paging,
    resetKey: recovery.key,
    hasRows: hasChoiceRows,
  });
  const value = outcome?.ok ? outcome.value : undefined;
  const ready = value?.status === "ready" ? value : undefined;
  return {
    search,
    setSearch,
    filtered: Boolean(typed),
    paging,
    ready,
    failed: Boolean(
      (outcome && (!outcome.ok || !outcome.value)) ||
      value?.status === "reset" ||
      tracked.stalled,
    ),
    paused: tracked.paused,
    resume: recovery.resume,
    // A same-page retry needs new arguments, hence a fresh subscription.
    retry: () => {
      paging.reset();
      recovery.retry();
    },
    items: ready?.items ?? [],
  };
}

function StackChoiceControls({
  choices,
  disabled,
}: {
  choices: ReturnType<typeof useStackChoices>;
  disabled: boolean;
}) {
  const { t, locale } = useFGText();
  const { ready, paging } = choices;
  return (
    <div className="space-y-3">
      <Input
        type="search"
        aria-label={t("paging.stackSearch")}
        placeholder={t("paging.stackSearch")}
        value={choices.search}
        disabled={disabled}
        onChange={(event) => choices.setSearch(event.target.value)}
      />
      {choices.failed ? (
        <Notice
          tone="danger"
          role="alert"
          title={t("paging.stackChoicesFailed")}
        >
          <Button
            variant="outline"
            className="mt-3"
            disabled={disabled}
            onClick={choices.retry}
          >
            {t("paging.retry")}
          </Button>
        </Notice>
      ) : choices.paused ? (
        <Button variant="outline" disabled={disabled} onClick={choices.resume}>
          {t("paging.continue")}
        </Button>
      ) : !ready ? (
        <p role="status" className="text-sm text-muted">
          {t("paging.stackSearching")}
        </p>
      ) : !ready.items.length && !paging.canPrevious ? (
        <p role="status" className="text-sm text-muted">
          {choices.filtered
            ? t("paging.stackNoMatches")
            : t(
                "copy.no-measured-pallets-are-available-create-and-measure-a-pallet-first",
              )}
        </p>
      ) : null}
      {(paging.canPrevious || (ready && !ready.isDone)) && (
        <CursorPagination
          label={t("paging.stackPages")}
          onFirst={paging.reset}
          historyTruncated={paging.historyTruncated}
          page={paging.page}
          pageSize={paging.pageSize}
          onPageSizeChange={paging.setPageSize}
          onPrevious={paging.previous}
          onNext={() => {
            if (ready && !ready.isDone) paging.next(ready.continueCursor);
          }}
          canPrevious={paging.canPrevious && !disabled}
          canNext={Boolean(ready && !ready.isDone) && !disabled}
          loading={!ready}
          locale={locale}
        />
      )}
    </div>
  );
}
