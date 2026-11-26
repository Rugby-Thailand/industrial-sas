"use client";

import { useQuery } from "convex/react";
import { ChevronRight, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type Ref } from "react";
import { api } from "../../../convex/_generated/api";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import {
  useDebouncedSearch,
  useScanContinuation,
} from "@/hooks/useScanContinuation";
import { Link } from "@/i18n/navigation";
import { customerWorkspacePath } from "@/lib/navigation";
import {
  readRememberedCustomerStatus,
  type CustomerStatusFilter,
} from "./useCustomerCatalogueState";

export function CustomerDirectory({
  scope,
  currentId,
  warehouse,
  searchRef,
  navigating,
}: {
  readonly scope: string;
  readonly currentId: string;
  readonly warehouse: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly navigating: boolean;
}) {
  const t = useTranslations("Customers");
  const desktop = useMediaQuery("(min-width: 64rem)");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(() =>
    readRememberedCustomerStatus(scope),
  );
  const settled = useDebouncedSearch(search);
  const criteria = { search: settled, status };
  const criteriaKey = JSON.stringify(criteria);
  const [position, setPosition] = useState<{ key: string; cursors: string[] }>({
    key: criteriaKey,
    cursors: [],
  });
  const cursors = position.key === criteriaKey ? position.cursors : [];
  if (position.key !== criteriaKey)
    setPosition({ key: criteriaKey, cursors: [] });
  const paging = {
    cursor: cursors.at(-1),
    canPrevious: cursors.length > 0,
    previous: () =>
      setPosition({ key: criteriaKey, cursors: cursors.slice(0, -1) }),
    next: (cursor: string) =>
      setPosition({ key: criteriaKey, cursors: [...cursors, cursor] }),
    reset: () => setPosition({ key: criteriaKey, cursors: [] }),
  };
  const scan = useScanContinuation(JSON.stringify([criteria, paging.cursor]));
  const outcome = useQuery(
    api.customers.catalogue.listCustomersPage,
    desktop && search === settled
      ? {
          search: settled,
          ...(status === "ALL" ? {} : { status }),
          ...(paging.cursor ? { cursor: paging.cursor } : {}),
          ...(scan.cursor ? { scanCursor: scan.cursor } : {}),
          pageSize: 20,
        }
      : "skip",
  );
  const sync = useCatalogueSync({
    outcome,
    continuation: scan,
    paging,
    resetKey: criteriaKey,
  });
  const entries =
    outcome?.ok && outcome.value.status === "ready" ? outcome.value.page : [];
  const canNext =
    outcome?.ok &&
    outcome.value.status === "ready" &&
    !outcome.value.isDone &&
    outcome.value.continueCursor;
  return (
    <aside
      aria-label={t("title")}
      inert={navigating}
      className="hidden min-w-0 flex-col rounded-lg border border-border bg-surface lg:sticky lg:top-4 lg:flex"
    >
      <h2 className="border-b border-border px-4 py-3 font-semibold">
        {t("title")}
      </h2>
      <div className="space-y-2 border-b border-border p-3">
        <label className="block text-sm text-muted">
          {t("workspace.directorySearch")}
          <span className="relative mt-1 block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              ref={searchRef}
              type="search"
              className="pl-8"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("workspace.searchPlaceholder")}
            />
          </span>
        </label>
        <SelectControl
          label={t("statusFilter")}
          placeholder={t("statusFilter")}
          emptyLabel={t("statusActive")}
          value={status}
          onValueChange={(value) => setStatus(value as CustomerStatusFilter)}
          className="w-full"
          options={[
            { value: "ACTIVE", label: t("statusActive") },
            { value: "ALL", label: t("statusAll") },
            { value: "ARCHIVED", label: t("statusArchived") },
          ]}
        />
      </div>
      {outcome === undefined ||
      (outcome.ok && outcome.value.status === "scanning") ? (
        <div className="p-3">
          <LedgerPanelStatus state={{ kind: "LOADING" }} />
        </div>
      ) : !outcome.ok ? (
        <div className="p-3">
          <LedgerPanelStatus
            state={{ kind: "DENIED", requestId: outcome.denial.requestId }}
          />
        </div>
      ) : outcome.value.status === "reset" ? (
        <div className="p-3">
          <Notice tone="warning" title={t("loadError")}>
            <Button variant="link" onClick={sync.retry}>
              {t("workspace.retry")}
            </Button>
          </Notice>
        </div>
      ) : entries.length === 0 ? (
        <p className="p-4 text-sm text-muted">{t("workspace.noCustomers")}</p>
      ) : (
        <ul className="max-h-[55dvh] divide-y divide-border overflow-y-auto">
          {entries.map((entry) => (
            <li key={entry.customerId}>
              <Link
                href={customerWorkspacePath(entry.customerId, { warehouse })}
                aria-current={
                  entry.customerId === currentId ? "page" : undefined
                }
                className="flex min-h-touch items-center gap-2 px-3 py-2 hover:bg-raised aria-[current=page]:bg-raised aria-[current=page]:text-link"
                prefetch={false}
              >
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm font-medium wrap-anywhere">
                    {entry.name}
                  </strong>
                  <span className="block text-xs wrap-anywhere text-muted">
                    {[entry.code, entry.province].filter(Boolean).join(" · ")}
                  </span>
                  {entry.status === "ARCHIVED" ? (
                    <StatusBadge tone="muted" label={t("statusArchived")} />
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
      )}
      {paging.canPrevious || canNext ? (
        <div className="flex flex-wrap justify-between gap-1 border-t border-border p-2">
          {paging.canPrevious ? (
            <Button size="sm" variant="ghost" onClick={paging.previous}>
              {t("previousPage")}
            </Button>
          ) : null}
          {canNext ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => paging.next(canNext)}
            >
              {t("nextPage")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
