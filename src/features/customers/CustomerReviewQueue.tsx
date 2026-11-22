"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Link2, Plus, Search, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAsyncOperation } from "@/hooks/useAsyncOperation";
import { Link, useRouter } from "@/i18n/navigation";
import { customerNewPath, ROUTES } from "@/lib/navigation";
import { returnFromTask } from "@/lib/taskNavigation";
import { CustomerGate, useSubmissionIdentity } from "./customerAccess";

interface ReviewCandidate {
  readonly customerId: Id<"customers">;
  readonly code: string;
  readonly name: string;
  readonly province?: string;
  readonly status: "ACTIVE" | "ARCHIVED";
}

interface ReviewGroup {
  readonly normalizedName: string;
  readonly displayName: string;
  readonly scanCount: number;
  readonly latestAt: number;
  readonly warehouses: readonly {
    readonly warehouseId: Id<"warehouses">;
    readonly name: string;
  }[];
  readonly scans: readonly {
    readonly jobScanId: Id<"finishedGoodsJobScans">;
    readonly warehouseId: Id<"warehouses">;
    readonly warehouseName: string;
    readonly factoryOrder: string;
    readonly partName?: string;
    readonly capturedName: string;
    readonly createdAt: number;
    readonly version: number;
  }[];
  readonly matchKind: "AMBIGUOUS" | "ARCHIVED" | "SIMILAR" | "NONE";
  readonly candidates: readonly ReviewCandidate[];
}

export function CustomerReviewQueue() {
  const t = useTranslations("Customers");
  return (
    <>
      <PageHeader
        title={t("reviewTitle")}
        summary={t("reviewSummary")}
        breadcrumbs={[{ label: t("title"), href: ROUTES.customers }]}
      />
      <CustomerGate loadingLabel={t("reviewLoading")}>
        <ReviewQueueContent />
      </CustomerGate>
    </>
  );
}

function ReviewQueueContent() {
  const t = useTranslations("Customers");
  const router = useRouter();
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const activeCursor = cursorStack.at(-1);
  const outcome = useQuery(
    api.customers.linking.listUnresolvedNames,
    activeCursor === undefined ? {} : { scanCursor: activeCursor },
  );
  const [pickerTarget, setPickerTarget] = useState<ReviewGroup | null>(null);
  const [selectedByGroup, setSelectedByGroup] = useState<
    Record<string, ReviewCandidate>
  >({});

  if (outcome === undefined) {
    return (
      <LedgerPanelStatus
        state={{ kind: "LOADING" }}
        label={t("reviewLoading")}
      />
    );
  }
  if (!outcome.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.denial.requestId }}
      />
    );
  }

  const { canViewWarehouseData, canReview, groups, hasMore, scanCursor } =
    outcome.value;
  if (!canViewWarehouseData) {
    return (
      <Notice
        tone="muted"
        title={t("reviewNoWarehouseAccess")}
        testId="review-no-warehouse"
      />
    );
  }
  if (groups.length === 0 && !hasMore && cursorStack.length === 0) {
    return (
      <EmptyState
        title={t("reviewEmptyTitle")}
        body={t("reviewEmptyBody")}
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => returnFromTask(ROUTES.customers, router.replace)}
          >
            {t("backToList")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="max-w-4xl space-y-4">
      {!canReview ? (
        <Notice tone="muted" title={t("viewOnly")} testId="review-view-only" />
      ) : null}
      {groups.length === 0 ? (
        <Notice
          tone="muted"
          title={t("reviewEmptyBatch")}
          testId="review-empty-batch"
        />
      ) : (
        <div className="space-y-4" data-testid="review-queue-list">
          {groups.map((group) => (
            <ReviewGroupCard
              key={group.normalizedName}
              group={group}
              canReview={canReview}
              selectedCustomer={selectedByGroup[group.normalizedName]}
              onSelectCustomer={(customer) =>
                setSelectedByGroup((current) => ({
                  ...current,
                  [group.normalizedName]: customer,
                }))
              }
              onChooseOther={() => setPickerTarget(group)}
            />
          ))}
        </div>
      )}
      {hasMore || cursorStack.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {cursorStack.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setCursorStack([])}
            >
              {t("reviewBackToFirst")}
            </Button>
          ) : null}
          {hasMore && scanCursor ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setCursorStack((current) => [...current, scanCursor])
              }
              data-testid="review-load-more"
            >
              {t("reviewLoadMore")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <CustomerPickerDialog
        group={pickerTarget}
        onClose={() => setPickerTarget(null)}
        onSelect={(customer) => {
          if (!pickerTarget) return;
          const key = pickerTarget.normalizedName;
          setSelectedByGroup((current) => ({ ...current, [key]: customer }));
          setPickerTarget(null);
        }}
      />
    </div>
  );
}

function ReviewGroupCard({
  group,
  canReview,
  selectedCustomer,
  onSelectCustomer,
  onChooseOther,
}: {
  readonly group: ReviewGroup;
  readonly canReview: boolean;
  readonly selectedCustomer?: ReviewCandidate | undefined;
  readonly onSelectCustomer: (customer: ReviewCandidate) => void;
  readonly onChooseOther: () => void;
}) {
  const t = useTranslations("Customers");
  const format = useFormatter();
  const headingId = useId();
  const resolve = useMutation(api.customers.linking.resolveUnresolvedScans);
  const identity = useSubmissionIdentity();
  const operation = useAsyncOperation({
    scope: `customer-review:${group.normalizedName}`,
    describeError: () => "UNKNOWN",
    navigation: "write",
  });

  const activeCandidates = group.candidates.filter(
    (candidate) => candidate.status === "ACTIVE",
  );
  // Per plan: a decision applies to the listed tickets only by default.
  const [rememberAlias, setRememberAlias] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"LINK" | "SKIP" | null>(
    null,
  );

  const visibleCandidates: readonly ReviewCandidate[] = selectedCustomer
    ? activeCandidates.some(
        (candidate) => candidate.customerId === selectedCustomer.customerId,
      )
      ? activeCandidates
      : [selectedCustomer, ...activeCandidates]
    : activeCandidates;

  const defaultCandidate =
    group.matchKind === "SIMILAR" && activeCandidates.length === 1
      ? activeCandidates[0]
      : undefined;
  const effectiveSelectedId =
    selectedCustomer?.customerId ?? defaultCandidate?.customerId ?? "";

  const reasonLabel =
    group.matchKind === "AMBIGUOUS"
      ? t("reviewReasonAmbiguous")
      : group.matchKind === "ARCHIVED"
        ? t("reviewReasonArchived")
        : group.matchKind === "SIMILAR"
          ? t("reviewReasonSimilar")
          : t("reviewReasonNone");

  async function submit(action: "LINK" | "SKIP") {
    if (operation.busy) return;
    if (action === "LINK" && !effectiveSelectedId) return;
    setErrorCode(null);
    setPendingAction(action);
    const scans = group.scans.map(({ jobScanId, version }) => ({
      jobScanId,
      expectedVersion: version,
    }));
    const payload = {
      action,
      ...(action === "LINK"
        ? {
            customerId: effectiveSelectedId as Id<"customers">,
            rememberAlias,
            ...(rememberAlias ? { aliasText: group.displayName } : {}),
          }
        : {}),
      scans,
    };
    const { requestId } = identity.request(JSON.stringify(payload), undefined);
    await operation.run(
      async () => resolve({ requestId, ...payload }),
      (outcome) => {
        identity.clear();
        setPendingAction(null);
        if (!outcome || typeof outcome !== "object" || !("ok" in outcome)) {
          setErrorCode("UNKNOWN");
          return;
        }
        if (!outcome.ok) {
          setErrorCode("DENIED");
          return;
        }
        if (!outcome.value.ok) {
          setErrorCode(outcome.value.code);
        }
      },
    );
  }

  const errorMessage =
    errorCode === "STALE_REVISION" || errorCode === "MIXED_NAME_GROUP"
      ? t("reviewErrorStale")
      : errorCode === "ALREADY_RESOLVED"
        ? t("reviewErrorAlreadyResolved")
        : errorCode === "ACCESS_DENIED" || errorCode === "DENIED"
          ? t("reviewErrorDenied")
          : errorCode || operation.error
            ? t("reviewErrorUnknown")
            : null;

  return (
    <article
      aria-labelledby={headingId}
      className="space-y-4 rounded-lg border border-border bg-surface p-4"
      data-testid="review-group-card"
    >
      <div className="space-y-1">
        <h2
          id={headingId}
          className="text-base leading-6 font-semibold wrap-anywhere text-text"
        >
          {group.displayName}
        </h2>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          <span className="tabular-nums">
            {t("reviewScanCount", { count: group.scanCount })}
          </span>
          <span>
            {t("reviewLatest", {
              date: format.dateTime(group.latestAt, { dateStyle: "medium" }),
            })}
          </span>
          {group.warehouses.length > 0 ? (
            <span>{group.warehouses.map((w) => w.name).join(", ")}</span>
          ) : null}
        </p>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-link hover:underline">
          {t("reviewShowTickets", { count: group.scans.length })}
        </summary>
        <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-canvas px-3">
          {group.scans.map((scan) => (
            <li
              key={scan.jobScanId}
              className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-xs"
            >
              <span className="min-w-0">
                <span className="font-mono font-medium text-text">
                  {scan.factoryOrder}
                </span>
                {scan.partName ? (
                  <span className="text-muted"> · {scan.partName}</span>
                ) : null}
                <span className="text-muted"> · {scan.warehouseName}</span>
              </span>
              <span className="text-muted tabular-nums">
                {format.dateTime(scan.createdAt, { dateStyle: "short" })}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <div className="space-y-3 border-t border-border pt-3">
        <p className="text-sm text-muted">{reasonLabel}</p>

        {visibleCandidates.length > 0 ? (
          <div
            role="radiogroup"
            aria-labelledby={headingId}
            className="space-y-2"
          >
            {visibleCandidates.map((candidate) => {
              const checked = effectiveSelectedId === candidate.customerId;
              return (
                <label
                  key={candidate.customerId}
                  className="flex min-h-touch cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-raised"
                >
                  <input
                    type="radio"
                    name={`customer-${headingId}`}
                    value={candidate.customerId}
                    checked={checked}
                    disabled={!canReview || operation.busy}
                    onChange={() => onSelectCustomer(candidate)}
                    className="mt-1 size-4 accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium wrap-anywhere text-text">
                      {candidate.name}
                    </span>
                    <span className="block text-xs text-muted">
                      <span className="font-mono">{candidate.code}</span>
                      {candidate.province ? ` · ${candidate.province}` : null}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : null}

        {canReview && effectiveSelectedId ? (
          <label className="flex min-h-touch cursor-pointer items-center gap-2.5 text-sm text-text">
            <CheckboxControl
              checked={rememberAlias}
              disabled={operation.busy}
              onChange={(event) => setRememberAlias(event.target.checked)}
            />
            <span>{t("reviewRememberAlias")}</span>
          </label>
        ) : null}

        {errorMessage ? (
          <Notice tone="danger" role="alert" title={errorMessage} />
        ) : null}

        {canReview ? (
          <div className="flex flex-wrap items-center gap-2">
            {effectiveSelectedId ? (
              <Button
                type="button"
                size="sm"
                disabled={operation.busy}
                onClick={() => void submit("LINK")}
                data-testid="review-link-button"
              >
                <Link2 aria-hidden="true" className="size-4" />
                {operation.busy && pendingAction === "LINK"
                  ? t("reviewLinking")
                  : t("reviewLinkAction", { count: group.scans.length })}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={operation.busy}
              onClick={onChooseOther}
            >
              <Users aria-hidden="true" className="size-4" />
              {visibleCandidates.length > 0
                ? t("reviewChooseOther")
                : t("reviewChooseCustomer")}
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={customerNewPath(group.displayName)}>
                <Plus aria-hidden="true" className="size-4" />
                {t("reviewCreateCustomer")}
              </Link>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={operation.busy}
              onClick={() => void submit("SKIP")}
              data-testid="review-skip-button"
            >
              {operation.busy && pendingAction === "SKIP"
                ? t("reviewSkipping")
                : t("reviewSkip")}
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function CustomerPickerDialog({
  group,
  onClose,
  onSelect,
}: {
  readonly group: ReviewGroup | null;
  readonly onClose: () => void;
  readonly onSelect: (customer: ReviewCandidate) => void;
}) {
  const t = useTranslations("Customers");
  const [search, setSearch] = useState("");
  const [scanCursor, setScanCursor] = useState<string | undefined>(undefined);
  const outcome = useQuery(
    api.customers.linking.searchCustomerOptions,
    group
      ? { search, ...(scanCursor === undefined ? {} : { scanCursor }) }
      : "skip",
  );
  const options = outcome?.ok ? outcome.value.items : [];
  const hasMore = Boolean(outcome?.ok && outcome.value.hasMore);
  const nextCursor = outcome?.ok ? outcome.value.scanCursor : undefined;

  function resetAndClose() {
    setSearch("");
    setScanCursor(undefined);
    onClose();
  }

  return (
    <Dialog
      open={group !== null}
      onOpenChange={(open) => {
        if (!open) resetAndClose();
      }}
    >
      <DialogContent closeLabel={t("reviewPickerClose")}>
        <DialogHeader>
          <DialogTitle>{t("reviewPickerTitle")}</DialogTitle>
          <DialogDescription>
            {group
              ? t("reviewPickerDescription", { name: group.displayName })
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setScanCursor(undefined);
              }}
              placeholder={t("reviewPickerSearch")}
              aria-label={t("reviewPickerSearch")}
              className="pl-9"
            />
          </div>
          {outcome === undefined ? (
            <LedgerPanelStatus
              state={{ kind: "LOADING" }}
              label={t("loading")}
            />
          ) : options.length === 0 && !hasMore ? (
            <p className="py-4 text-center text-sm text-muted">
              {t("reviewPickerEmpty")}
            </p>
          ) : (
            <>
              {options.length > 0 ? (
                <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {options.map((customer) => (
                    <li key={customer.customerId}>
                      <button
                        type="button"
                        className="flex min-h-touch w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-link"
                        onClick={() => {
                          setSearch("");
                          setScanCursor(undefined);
                          onSelect(customer);
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium wrap-anywhere text-text">
                            {customer.name}
                          </span>
                          <span className="block text-xs text-muted">
                            <span className="font-mono">{customer.code}</span>
                            {customer.province
                              ? ` · ${customer.province}`
                              : null}
                          </span>
                        </span>
                        <Check
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {hasMore && nextCursor ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setScanCursor(nextCursor)}
                >
                  {t("reviewPickerLoadMore")}
                </Button>
              ) : null}
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={resetAndClose}>
            {t("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
