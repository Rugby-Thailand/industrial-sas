import type { ReactNode } from "react";

/** The icon, title and intro that head each HR settings panel. */
export function SettingsHeading({
  id,
  icon,
  title,
  description,
  action,
}: {
  readonly id: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-border pb-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-surface text-link">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-lg leading-7 font-semibold text-text">
          {title}
        </h2>
        {description === undefined ? null : (
          <p className="text-sm text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
