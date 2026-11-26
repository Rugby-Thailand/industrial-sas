"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Box,
  ChevronRight,
  ClipboardList,
  MapPin,
  Package,
  TriangleAlert,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { SelectControl } from "@/components/ui/SelectControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Link } from "@/i18n/navigation";
import {
  jobScanRecordSearchPath,
  palletPath,
  productPath,
  ROUTES,
  type CustomerWorkspaceJobFilter,
  type CustomerWorkspaceSection,
} from "@/lib/navigation";
import { CustomerDetailCard } from "./CustomerDetailCard";

type SuccessValue<T> = T extends { ok: true; value: infer Value }
  ? Value
  : never;
export type Workspace = NonNullable<
  SuccessValue<
    FunctionReturnType<typeof api.customers.workspace.getCustomerWorkspace>
  >
>;
type JobsResult = FunctionReturnType<
  typeof api.customers.workspace.listCustomerWorkspaceJobs
>;
type ProductsResult = FunctionReturnType<
  typeof api.customers.workspace.listCustomerWorkspaceProducts
>;
type Job = NonNullable<SuccessValue<JobsResult>>["items"][number];
type Product = NonNullable<SuccessValue<ProductsResult>>["items"][number];

type SectionProps = {
  readonly customerId: Id<"customers">;
  readonly shell: Workspace | null | undefined;
  readonly loading: boolean;
  readonly section: CustomerWorkspaceSection;
  readonly warehouse: string;
  readonly filter: CustomerWorkspaceJobFilter;
  readonly onSection: (
    section: CustomerWorkspaceSection,
    filter?: CustomerWorkspaceJobFilter,
  ) => void;
  readonly onFilter: (filter: CustomerWorkspaceJobFilter) => void;
};

export function CustomerWarehouseSection({
  shell,
  loading,
  section,
  warehouse,
  customerId,
  filter,
  onSection,
  onFilter,
}: SectionProps) {
  const t = useTranslations("Customers.workspace");
  if (loading) return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!shell?.access.canViewWarehouseData) return null;
  if (!shell.scopeAvailable) return null;
  const args = {
    customerId,
    ...(warehouse === "all"
      ? {}
      : { warehouseId: warehouse as Id<"warehouses"> }),
  };
  if (section === "overview")
    return (
      <WarehouseOverview shell={shell} args={args} onSection={onSection} />
    );
  if (section === "jobs")
    return <WorkspaceJobs args={args} filter={filter} onFilter={onFilter} />;
  return (
    <CustomerDetailCard
      title={t(section === "stock" ? "stock" : "products")}
      action={
        section === "products" ? (
          <Button
            variant="link"
            className="h-auto min-h-touch px-0 whitespace-normal"
            onClick={() => onSection("stock")}
          >
            {t("openStock")}
          </Button>
        ) : null
      }
    >
      <WorkspaceProducts
        args={args}
        mode={section === "stock" ? "stock" : "products"}
      />
    </CustomerDetailCard>
  );
}

type ScopeArgs = {
  readonly customerId: Id<"customers">;
  readonly warehouseId?: Id<"warehouses">;
};

function WarehouseOverview({
  shell,
  args,
  onSection,
}: {
  readonly shell: Workspace;
  readonly args: ScopeArgs;
  readonly onSection: SectionProps["onSection"];
}) {
  const t = useTranslations("Customers.workspace");
  const format = useFormatter();
  const rollup = shell.rollup;
  if (!rollup) return null;
  const pending = shell.access.canReview ? rollup.pendingReview : undefined;
  const showReview = !!pending && (pending.names > 0 || !pending.complete);
  const showUnmapped =
    rollup.unmappedJobs.count > 0 || !rollup.unmappedJobs.complete;
  const bounded = ({
    count,
    complete,
  }: {
    count: number;
    complete: boolean;
  }) => (complete ? format.number(count) : t("atLeast", { count }));
  return (
    <div className="min-w-0 space-y-4">
      <div
        aria-label={t("warehouseSummary")}
        className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-surface"
      >
        {(
          [
            {
              section: "jobs",
              count: rollup.linkedJobs,
              icon: ClipboardList,
              label: t("linkedJobs"),
            },
            {
              section: "products",
              count: rollup.linkedProducts,
              icon: Box,
              label: t("linkedProducts"),
            },
            {
              section: "stock",
              count: rollup.storedPallets,
              icon: Package,
              label: t("stock"),
            },
          ] as const
        ).map(({ section, count, icon: Icon, label }) => (
          <button
            key={section}
            type="button"
            onClick={() => onSection(section)}
            className="min-w-0 p-2.5 text-start hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:p-4"
          >
            <Icon aria-hidden="true" className="mb-1 size-4 text-muted" />
            <span className="block text-xs wrap-anywhere text-muted">
              {label}
            </span>
            <strong className="mt-1 block text-xl tabular-nums">
              {section === "stock" && !count.complete && count.count === 0 ? (
                <span className="text-sm font-medium text-muted">
                  {t("stockPending")}
                </span>
              ) : (
                bounded(count)
              )}
            </strong>
          </button>
        ))}
      </div>
      {showReview || showUnmapped ? (
        <CustomerDetailCard title={t("attention")}>
          <ul className="divide-y divide-border">
            {showReview ? (
              <li>
                <Link href={ROUTES.customerReview} className={ROW}>
                  <TriangleAlert
                    aria-hidden="true"
                    className="size-4 shrink-0 text-warning"
                  />
                  <span className="min-w-0 flex-1">
                    <strong className="block font-medium">
                      {t("reviewNames")}
                    </strong>
                    <small className="text-muted">
                      {pending.names === 0
                        ? t("reviewCountUnknown")
                        : t(
                            pending.complete
                              ? "reviewCounts"
                              : "reviewCountsPartial",
                            { names: pending.names, scans: pending.scans },
                          )}
                    </small>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0"
                  />
                </Link>
              </li>
            ) : null}
            {showUnmapped ? (
              <li>
                <button
                  type="button"
                  className={ROW}
                  onClick={() => onSection("jobs", "unmapped")}
                >
                  <MapPin
                    aria-hidden="true"
                    className="size-4 shrink-0 text-warning"
                  />
                  <span className="flex-1">
                    {rollup.unmappedJobs.count === 0
                      ? t("unmappedCountUnknown")
                      : t(
                          rollup.unmappedJobs.complete
                            ? "unmappedCount"
                            : "unmappedCountPartial",
                          {
                            count: rollup.unmappedJobs.count,
                          },
                        )}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0"
                  />
                </button>
              </li>
            ) : null}
          </ul>
        </CustomerDetailCard>
      ) : null}
      <CustomerDetailCard
        title={t("latestJobs")}
        action={<ViewAll onClick={() => onSection("jobs")} />}
      >
        <JobRows jobs={shell.latestJobs} />
      </CustomerDetailCard>
      <CustomerDetailCard
        title={t("linkedProducts")}
        action={<ViewAll onClick={() => onSection("products")} />}
      >
        <WorkspaceProducts args={args} mode="preview" />
      </CustomerDetailCard>
    </div>
  );
}

const ROW =
  "flex min-h-touch w-full items-center gap-3 rounded-sm px-1 py-2 text-start text-sm hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

function ViewAll({ onClick }: { readonly onClick: () => void }) {
  const t = useTranslations("Customers.workspace");
  return (
    <Button
      variant="link"
      className="h-auto min-h-touch shrink-0 px-0"
      onClick={onClick}
    >
      {t("viewAll")}
    </Button>
  );
}

function JobRows({ jobs }: { readonly jobs: readonly Job[] }) {
  const t = useTranslations("Customers");
  const format = useFormatter();
  if (jobs.length === 0)
    return <p className="text-sm text-muted">{t("noLinkedJobs")}</p>;
  return (
    <ul className="divide-y divide-border" data-testid="customer-recent-jobs">
      {jobs.map((job) => (
        <li key={job.jobScanId}>
          <Link
            href={jobScanRecordSearchPath(job.warehouseId, job.factoryOrder)}
            className={ROW}
            prefetch={false}
          >
            <ClipboardList
              aria-hidden="true"
              className="hidden size-4 shrink-0 text-muted sm:block"
            />
            <span className="min-w-0 flex-1 wrap-anywhere">
              <strong className="block font-mono font-medium text-link">
                {job.factoryOrder}
              </strong>
              <span className="block">
                {job.partName ?? job.productCode}
                {job.partName && job.productCode ? ` · ${job.productCode}` : ""}
              </span>
              <small className="text-muted">
                {[
                  job.warehouseName,
                  format.dateTime(job.createdAt, {
                    dateStyle: "short",
                    timeStyle: "short",
                  }),
                  t(`workspace.source.${job.source}`),
                ].join(" · ")}
              </small>
              {job.quantity === undefined ? null : (
                <small className="block text-muted">
                  {t("workspace.quantity", { count: job.quantity })}
                </small>
              )}
            </span>
            <span className="text-end wrap-anywhere">
              <StatusBadge
                tone={job.mapped ? "success" : "warning"}
                label={t(
                  job.mapped ? "workspace.mapped" : "workspace.unmapped",
                )}
              />
              {job.locationCode || job.locationName || job.locationText ? (
                <small className="block text-muted">
                  {job.locationCode ?? job.locationName ?? job.locationText}
                </small>
              ) : null}
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function WorkspaceJobs({
  args,
  filter,
  onFilter,
}: {
  readonly args: ScopeArgs;
  readonly filter: CustomerWorkspaceJobFilter;
  readonly onFilter: SectionProps["onFilter"];
}) {
  const t = useTranslations("Customers.workspace");
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const outcome = useQuery(api.customers.workspace.listCustomerWorkspaceJobs, {
    ...args,
    filter,
    ...(cursor ? { cursor } : {}),
  });
  return (
    <CustomerDetailCard
      title={t("jobs")}
      action={
        <SelectControl
          label={t("jobFilter")}
          placeholder={t("jobFilter")}
          emptyLabel={t("allJobs")}
          value={filter}
          onValueChange={(value) =>
            onFilter(value as CustomerWorkspaceJobFilter)
          }
          options={[
            { value: "all", label: t("allJobs") },
            { value: "mapped", label: t("mapped") },
            { value: "unmapped", label: t("unmapped") },
          ]}
        />
      }
    >
      <PageResults outcome={outcome} cursors={cursors} setCursors={setCursors}>
        {(jobs) => <JobRows jobs={jobs} />}
      </PageResults>
    </CustomerDetailCard>
  );
}

function WorkspaceProducts({
  args,
  mode,
}: {
  readonly args: ScopeArgs;
  readonly mode: "preview" | "products" | "stock";
}) {
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const outcome = useQuery(
    api.customers.workspace.listCustomerWorkspaceProducts,
    {
      ...args,
      ...(cursor ? { cursor } : {}),
      ...(mode === "preview" ? { pageSize: 5, includePallets: false } : {}),
    },
  );
  return (
    <PageResults
      outcome={outcome}
      cursors={cursors}
      setCursors={mode === "preview" ? undefined : setCursors}
    >
      {(products) =>
        mode === "stock" ? (
          <StockRows products={products} />
        ) : (
          <ProductRows products={products} />
        )
      }
    </PageResults>
  );
}

function PageResults<Item>({
  outcome,
  cursors,
  setCursors,
  children,
}: {
  readonly outcome:
    | {
        ok: true;
        value: {
          canViewWarehouseData: boolean;
          items: readonly Item[];
          isDone: boolean;
          continueCursor: string;
        } | null;
      }
    | { ok: false; denial: { requestId: string } }
    | undefined;
  readonly cursors: readonly string[];
  readonly setCursors: ((value: string[]) => void) | undefined;
  readonly children: (items: readonly Item[]) => ReactNode;
}) {
  const t = useTranslations("Customers");
  const page = outcome?.ok ? outcome.value : undefined;
  return (
    <>
      {outcome === undefined ? (
        <LedgerPanelStatus state={{ kind: "LOADING" }} />
      ) : !outcome.ok ? (
        <LedgerPanelStatus
          state={{ kind: "DENIED", requestId: outcome.denial.requestId }}
        />
      ) : page?.canViewWarehouseData ? (
        children(page.items)
      ) : null}
      {setCursors ? (
        <div className="flex flex-wrap gap-2">
          {cursors.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCursors(cursors.slice(0, -1))}
            >
              {t("previousPage")}
            </Button>
          ) : null}
          {page?.canViewWarehouseData && !page.isDone && page.continueCursor ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCursors([...cursors, page.continueCursor])}
            >
              {t("nextPage")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function ProductRows({ products }: { readonly products: readonly Product[] }) {
  const t = useTranslations("Customers.workspace");
  if (products.length === 0)
    return <p className="text-sm text-muted">{t("noProducts")}</p>;
  return (
    <ul
      className="divide-y divide-border"
      data-testid="customer-linked-products"
    >
      {products.map((product) => (
        <li key={product.productId}>
          <Link
            href={productPath(product.productId, product.warehouseId)}
            prefetch={false}
            className={ROW}
          >
            <Box
              aria-hidden="true"
              className="hidden size-4 shrink-0 text-muted sm:block"
            />
            <span className="min-w-0 flex-1 wrap-anywhere">
              <strong className="block font-mono font-medium text-link">
                {product.sku}
              </strong>
              <span className="block">{product.name}</span>
              <small className="text-muted">
                {[
                  product.warehouseName,
                  product.customerReference,
                  ...product.zones,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            <span className="max-w-[40%] text-end text-xs wrap-anywhere text-muted">
              <span className="block">
                {t(`productStatus.${product.status}`)}
              </span>
              <span className="block">
                {product.storedCount === undefined
                  ? t("stockPending")
                  : t("palletCount", { count: product.storedCount })}
              </span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function StockRows({ products }: { readonly products: readonly Product[] }) {
  const t = useTranslations("Customers.workspace");
  const format = useFormatter();
  if (products.length === 0)
    return <p className="text-sm text-muted">{t("noProducts")}</p>;
  return (
    <ul className="divide-y divide-border">
      {products.map((product) => (
        <li key={product.productId} className="py-3">
          <h3 className="font-medium wrap-anywhere">
            {product.name}{" "}
            <span className="font-mono text-sm text-muted">{product.sku}</span>
          </h3>
          <p className="text-sm wrap-anywhere text-muted">
            {product.warehouseName}
          </p>
          {product.pallets.length > 0 ? (
            <ul className="mt-2 divide-y divide-border">
              {product.pallets.map((pallet) => (
                <li key={pallet.palletId}>
                  <Link
                    href={palletPath(pallet.palletId)}
                    prefetch={false}
                    className={ROW}
                  >
                    <Package
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted"
                    />
                    <span className="min-w-0 flex-1 wrap-anywhere">
                      <strong className="block font-mono font-medium text-link">
                        {pallet.code}
                      </strong>
                      <small className="text-muted">
                        {[pallet.positionCode, pallet.zoneLabel]
                          .filter(Boolean)
                          .join(" · ") || t("noPosition")}
                      </small>
                    </span>
                    <span className="text-end">
                      {format.number(pallet.quantity)} {product.unit}
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">{t("noPallets")}</p>
          )}
          {product.hasMorePallets ? (
            <Button asChild variant="link" className="px-0">
              <Link href={productPath(product.productId, product.warehouseId)}>
                {t("allPallets")}
              </Link>
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
