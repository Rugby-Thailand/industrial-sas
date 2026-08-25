"use client";

import {
  ArrowLeftRight,
  Boxes,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Factory,
  ListChecks,
  MapPin,
  PackageCheck,
  PackageMinus,
  PackageSearch,
  ShieldCheck,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Link } from "@/i18n/navigation";
import { visibleHandheldTasks } from "@/lib/navigation";

interface HandheldTaskLauncherProps {
  readonly labels: {
    readonly tasks: Readonly<Record<string, string>>;
    readonly unavailable: string;
    readonly unavailableTitle: string;
    readonly loading: string;
  };
}

/**
 * One glyph per task so a gloved operator can find "receive" by shape before
 * reading. Decorative only — the adjacent text is the accessible name — and
 * keyed by `labelKey` here rather than in `lib/navigation`, which stays free
 * of rendering concerns.
 */
const TASK_ICONS: Readonly<Record<string, LucideIcon>> = {
  taskWork: ClipboardList,
  taskLookup: PackageSearch,
  taskReceive: PackageCheck,
  taskQuality: ShieldCheck,
  taskPutaway: Warehouse,
  taskCount: ListChecks,
  taskPick: PackageMinus,
  taskLoad: Truck,
  taskDelivery: MapPin,
  taskTransfer: ArrowLeftRight,
  taskAttendance: CalendarClock,
  taskProduction: Factory,
  taskPallet: Boxes,
};

/** Permission-aware task choices for the authenticated handheld membership. */
export function HandheldTaskLauncher({ labels }: HandheldTaskLauncherProps) {
  const workspace = useWorkspace();

  if (!workspace.permissionsReady) {
    return (
      <p role="status" className="text-text-muted py-4 text-sm">
        {labels.loading}
      </p>
    );
  }

  const tasks = visibleHandheldTasks(workspace.navigationPermissions);
  return (
    <ul className="flex flex-col gap-3">
      {tasks.map((task) => {
        const Icon = TASK_ICONS[task.labelKey];
        return (
          <li key={task.labelKey}>
            {task.available && task.href !== undefined ? (
              <Link
                href={task.href}
                className="flex min-h-touch items-center gap-3 rounded-lg border-2 border-border-strong bg-surface px-4 py-3 text-lg font-semibold text-text"
              >
                {Icon === undefined ? null : (
                  <Icon
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted"
                  />
                )}
                {labels.tasks[task.labelKey] ?? task.labelKey}
                <ChevronRight
                  aria-hidden="true"
                  className="ml-auto size-5 shrink-0 text-muted"
                />
              </Link>
            ) : (
              <div className="flex min-h-touch flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
                {Icon === undefined ? null : (
                  <Icon
                    aria-hidden="true"
                    className="size-5 shrink-0 text-disabled"
                  />
                )}
                <span className="text-lg font-semibold text-disabled">
                  {labels.tasks[task.labelKey] ?? task.labelKey}
                </span>
                <StatusBadge
                  tone="muted"
                  label={labels.unavailable}
                  title={labels.unavailableTitle}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
