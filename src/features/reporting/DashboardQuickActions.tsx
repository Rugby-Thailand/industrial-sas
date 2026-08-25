"use client";

import { useMutation, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Boxes,
  ChartNoAxesCombined,
  ClipboardCheck,
  Factory,
  FileClock,
  FileText,
  ListChecks,
  PackageCheck,
  Pencil,
  PlugZap,
  ScanLine,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { DashboardActionId } from "../../../convex/model/reporting/dashboardPreferences";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import {
  type DashboardPreferencePayload,
  readDashboardPreferencesRef,
  resetDashboardPreferencesRef,
  updateDashboardPreferencesRef,
} from "@/lib/convex/reportingApi";
import { ROUTES } from "@/lib/navigation";

const ACTIONS = {
  CUSTOMER_ORDERS: { href: ROUTES.customerOrders, icon: ShoppingCart },
  FULFILLMENT: { href: ROUTES.fulfillment, icon: PackageCheck },
  PRODUCTION_STATUS: { href: ROUTES.productionOrders, icon: Factory },
  INVENTORY_HEALTH: { href: ROUTES.balances, icon: Boxes },
  OPERATIONAL_REPORTS: { href: ROUTES.reports, icon: ChartNoAxesCombined },
  INTEGRATION_HEALTH: { href: ROUTES.integrations, icon: PlugZap },
  RECEIVING: { href: ROUTES.receiving, icon: PackageCheck },
  QUALITY: { href: ROUTES.quality, icon: ClipboardCheck },
  PUTAWAY: { href: ROUTES.putaway, icon: ScanLine },
  INVENTORY_HISTORY: { href: ROUTES.history, icon: FileClock },
  STOCK_COUNTS: { href: ROUTES.countPlans, icon: ListChecks },
  ITEM_REGISTER: { href: ROUTES.items, icon: FileText },
} as const satisfies Record<
  DashboardActionId,
  { readonly href: string; readonly icon: typeof Boxes }
>;

const PREVIEW_PREFERENCE: DashboardPreferencePayload = {
  pageKey: "OWNER_DASHBOARD",
  presetVersion: 1,
  customized: false,
  selectedActionIds: [
    "CUSTOMER_ORDERS",
    "FULFILLMENT",
    "PRODUCTION_STATUS",
    "INVENTORY_HEALTH",
    "OPERATIONAL_REPORTS",
    "INTEGRATION_HEALTH",
  ],
  availableActionIds: Object.keys(ACTIONS) as DashboardActionId[],
};

const move = (
  values: readonly DashboardActionId[],
  from: number,
  to: number,
): DashboardActionId[] => {
  if (to < 0 || to >= values.length) return [...values];
  const next = [...values];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
};

export function QuickActionMenu({
  preference,
  busy,
  onSave,
  onReset,
  statusMessage,
}: {
  readonly preference: DashboardPreferencePayload;
  readonly busy: boolean;
  readonly onSave: (
    actionIds: readonly DashboardActionId[],
  ) => Promise<boolean>;
  readonly onReset: () => Promise<void>;
  readonly statusMessage?: string | undefined;
}) {
  const t = useTranslations("OwnerDashboard");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<readonly DashboardActionId[]>(
    preference.selectedActionIds,
  );

  const actionLabel = (id: DashboardActionId) => t(`actions.${id}.label`);
  const available = preference.availableActionIds.filter(
    (id) => !draft.includes(id),
  );

  const openEditor = (next: boolean) => {
    if (next) setDraft(preference.selectedActionIds);
    setOpen(next);
  };

  const save = async () => {
    if (await onSave(draft)) setOpen(false);
  };

  const reset = async () => {
    await onReset();
    setOpen(false);
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">
          {t("quickActionsTitle")}
        </h2>
        <Dialog open={open} onOpenChange={openEditor}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-accent hover:bg-accent/10 hover:text-accent"
              aria-label={t("customize")}
              title={t("customize")}
            >
              <Pencil aria-hidden="true" className="size-5 text-accent" />
            </Button>
          </DialogTrigger>
          <DialogContent closeLabel={t("cancel")}>
            <DialogHeader>
              <DialogTitle>{t("customizeTitle")}</DialogTitle>
              <DialogDescription>{t("customizeDescription")}</DialogDescription>
            </DialogHeader>

            <section aria-labelledby="selected-actions-heading">
              <h3
                id="selected-actions-heading"
                className="text-sm font-semibold text-text"
              >
                {t("selectedActions", { count: draft.length })}
              </h3>
              {draft.length === 0 ? (
                <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted">
                  {t("emptySelection")}
                </p>
              ) : (
                <ol className="mt-2 grid gap-2">
                  {draft.map((id, index) => (
                    <li
                      key={id}
                      className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2"
                    >
                      <span className="min-w-0 flex-1 text-sm font-medium text-text">
                        {actionLabel(id)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy || index === 0}
                        aria-label={t("moveUp", { label: actionLabel(id) })}
                        onClick={() => setDraft(move(draft, index, index - 1))}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy || index === draft.length - 1}
                        aria-label={t("moveDown", { label: actionLabel(id) })}
                        onClick={() => setDraft(move(draft, index, index + 1))}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label={t("remove", { label: actionLabel(id) })}
                        onClick={() =>
                          setDraft(draft.filter((value) => value !== id))
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {available.length > 0 ? (
              <section aria-labelledby="available-actions-heading">
                <h3
                  id="available-actions-heading"
                  className="text-sm font-semibold text-text"
                >
                  {t("availableActions")}
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {available.map((id) => (
                    <Button
                      key={id}
                      type="button"
                      variant="outline"
                      size="default"
                      disabled={busy || draft.length >= 6}
                      onClick={() => setDraft([...draft, id])}
                    >
                      {t("add", { label: actionLabel(id) })}
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={reset}
              >
                {t("reset")}
              </Button>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  {t("cancel")}
                </Button>
              </DialogClose>
              <Button type="button" disabled={busy} onClick={save}>
                {busy ? t("saving") : t("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {preference.selectedActionIds.length === 0 ? (
        <Card className="border-dashed p-5 text-sm text-muted">
          {t("noQuickActions")}
        </Card>
      ) : (
        <ul
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="dashboard-actions"
        >
          {preference.selectedActionIds.map((id) => {
            const action = ACTIONS[id];
            const Icon = action.icon;
            return (
              <li key={id}>
                <Link
                  href={action.href}
                  className="group relative flex h-full min-h-24 items-center gap-3 overflow-hidden rounded-xl border border-border bg-raised/45 p-4 transition hover:-translate-y-0.5 hover:border-accent hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-4 left-0 w-0.5 rounded-full bg-accent opacity-70"
                  />
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-accent shadow-sm">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-text">
                      {actionLabel(id)}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                      {t(`actions.${id}.description`)}
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted group-hover:text-accent"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {statusMessage ? (
        <p role="status" className="mt-2 text-sm text-muted">
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}

export function DashboardQuickActions() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <QuickActionMenu
            preference={PREVIEW_PREFERENCE}
            busy={false}
            onSave={async () => false}
            onReset={async () => undefined}
          />
        ) : (
          <ServerDashboardQuickActions warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerDashboardQuickActions({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const t = useTranslations("OwnerDashboard");
  const outcome = useQuery(readDashboardPreferencesRef, { warehouseId });
  const update = useMutation(updateDashboardPreferencesRef);
  const reset = useMutation(resetDashboardPreferencesRef);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>();

  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  }

  const onSave = async (actionIds: readonly DashboardActionId[]) => {
    setBusy(true);
    setStatusMessage(undefined);
    try {
      const result = await update({ warehouseId, actionIds: [...actionIds] });
      if (!result.ok) {
        setStatusMessage(t("saveDenied", { requestId: result.requestId }));
        return false;
      }
      if (!result.value.accepted) {
        setStatusMessage(t(`saveErrors.${result.value.code}`));
        return false;
      }
      setStatusMessage(t("saved"));
      return true;
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    setBusy(true);
    setStatusMessage(undefined);
    try {
      const result = await reset({ warehouseId });
      setStatusMessage(
        result.ok
          ? t("resetDone")
          : t("saveDenied", { requestId: result.requestId }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <QuickActionMenu
      preference={outcome.value}
      busy={busy}
      onSave={onSave}
      onReset={onReset}
      statusMessage={statusMessage}
    />
  );
}
