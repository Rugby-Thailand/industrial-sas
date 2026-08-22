"use client";

import {
  Boxes,
  ClipboardCheck,
  FileDown,
  PackageCheck,
  ScanLine,
  Truck,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/navigation";

const ACTIONS = [
  { href: ROUTES.purchaseOrders, label: "purchaseOrders", icon: Truck },
  { href: ROUTES.receiving, label: "receiving", icon: PackageCheck },
  { href: ROUTES.quality, label: "quality", icon: ClipboardCheck },
  { href: ROUTES.putaway, label: "putaway", icon: ScanLine },
  { href: ROUTES.balances, label: "balances", icon: Boxes },
  { href: ROUTES.reports, label: "reports", icon: FileDown },
] as const;

/** Short paths from a counter to the work that clears it. */
export function DashboardQuickActions() {
  const t = useTranslations("Navigation");

  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="dashboard-actions">
      {ACTIONS.map(({ href, label, icon: Icon }) => (
        <li key={href}>
          <Card
            size="sm"
            className="h-full transition-colors hover:border-accent"
          >
            <Link
              href={href}
              className="flex min-h-touch items-center gap-3 px-4 py-3 text-sm font-semibold text-text"
            >
              <span className="rounded-md bg-raised p-2 text-accent">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              {t(label)}
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  );
}
