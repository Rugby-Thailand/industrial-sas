import { useId, type ReactNode } from "react";

export function CustomerDetailCard({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={id} className="text-lg leading-7 font-semibold text-text">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
