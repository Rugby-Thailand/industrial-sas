"use client";

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
      {tasks.map((task) => (
        <li key={task.labelKey}>
          {task.available && task.href !== undefined ? (
            <Link
              href={task.href}
              className="flex min-h-touch items-center rounded-lg border-2 border-border-strong bg-surface px-4 py-3 text-lg font-semibold text-text"
            >
              {labels.tasks[task.labelKey] ?? task.labelKey}
            </Link>
          ) : (
            <div className="flex min-h-touch flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
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
      ))}
    </ul>
  );
}
