"use client";

import { useQuery } from "convex/react";
import {
  CalendarDays,
  Bell,
  FileText,
  Megaphone,
  Umbrella,
  ClipboardList,
  Clock,
  History,
  Settings2,
  UserRound,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { OutcomeGate } from "@/components/system/DataGate";
import { Notice } from "@/components/ui/Notice";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { buttonVariants } from "@/components/ui/buttonVariants";
import { Link } from "@/i18n/navigation";
import { hrRefs } from "@/lib/convex/hrApi";
import { ROUTES } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { HrActionCard } from "./HrActionCard";

export const HR_SHORTCUTS = [
  { key: "hr.today", name: "today", href: ROUTES.hrToday, icon: Clock },
  { key: "hr.time", name: "time", href: ROUTES.hrTime, icon: History },
  {
    key: "hr.requests",
    name: "requests",
    href: ROUTES.hrRequests,
    icon: ClipboardList,
  },
  {
    key: "hr.holidays",
    name: "holidays",
    href: ROUTES.hrHolidays,
    icon: CalendarDays,
  },
  {
    key: "hr.profile",
    name: "profile",
    href: ROUTES.hrProfile,
    icon: UserRound,
  },
  { key: "hr.leave", name: "leave", href: ROUTES.hrLeave, icon: Umbrella },
  {
    key: "hr.announcements",
    name: "announcements",
    href: ROUTES.hrAnnouncements,
    icon: Megaphone,
  },
  {
    key: "hr.payslips",
    name: "payslips",
    href: ROUTES.hrPayslips,
    icon: FileText,
  },
  {
    key: "hr.notifications",
    name: "notifications",
    href: ROUTES.hrNotifications,
    icon: Bell,
  },
] as const;

export interface HrShortcutPreference {
  readonly key: string;
  readonly visible: boolean;
}

/** The same real action cards in the home view and customization preview. */
export function HrShortcutCards({
  shortcuts,
  preview = false,
}: {
  readonly shortcuts: readonly HrShortcutPreference[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("Hr.shortcuts");
  const visible = shortcuts.filter((item) => item.visible);
  if (visible.length === 0)
    return <p className="text-sm text-muted">{t("empty")}</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((item) => {
        const shortcut = HR_SHORTCUTS.find(
          (candidate) => candidate.key === item.key,
        );
        if (shortcut === undefined) return null;
        return (
          <HrActionCard
            key={item.key}
            icon={shortcut.icon}
            label={t(`items.${shortcut.name}.label`)}
            description={t(`items.${shortcut.name}.hint`)}
            {...(preview ? {} : { href: shortcut.href })}
          />
        );
      })}
    </div>
  );
}

export function HrShortcuts() {
  const t = useTranslations("Hr.shortcuts");
  const preferences = useQuery(hrRefs.shortcutPreferences, {});
  return (
    <section aria-labelledby="hr-shortcuts-heading" className="space-y-section">
      <SectionHeader
        id="hr-shortcuts-heading"
        title={t("homeTitle")}
        actions={
          <Link
            id="hr-customize-shortcuts"
            href={ROUTES.hrCustomize}
            className={cn(
              buttonVariants({ variant: "link" }),
              "px-0 dense:px-0",
            )}
          >
            <Settings2 aria-hidden="true" className="size-4" />
            {t("customize")}
          </Link>
        }
      />
      <OutcomeGate outcome={preferences}>
        {({ value }) =>
          value.ok ? (
            <HrShortcutCards shortcuts={value.shortcuts} />
          ) : (
            <Notice tone="neutral" title={t("notLinked")} />
          )
        }
      </OutcomeGate>
    </section>
  );
}
