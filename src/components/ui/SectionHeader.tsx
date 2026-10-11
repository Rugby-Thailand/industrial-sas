import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The heading row of an ordinary titled task section: an 18/28 semibold
 * heading, an optional short description and an action slot that wraps below
 * the heading on narrow screens. Outer spacing belongs to the surrounding
 * layout (for example `space-y-section`), so the header adds no margin.
 */
export function SectionHeader({
  title,
  description,
  actions,
  id,
  level = 2,
  className,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  /** For `aria-labelledby` on the section this header names. */
  readonly id?: string;
  /** Heading level within the page outline; the visual size stays the same. */
  readonly level?: 2 | 3;
  readonly className?: string;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2",
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-60">
        <Heading
          {...(id === undefined ? {} : { id })}
          className="text-lg leading-7 font-semibold tracking-[-0.01em] text-balance break-words text-text"
        >
          {title}
        </Heading>
        {description === undefined ? null : (
          <p className="mt-1 text-sm leading-5 text-muted">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
