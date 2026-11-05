"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** A bounded results list with an explicit cue only while more rows lie below. */
export function SearchResultsViewport({
  id,
  label,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly children: ReactNode;
}) {
  const t = useTranslations("Search");
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  useEffect(() => {
    const element = viewport.current;
    if (element === null) return;
    const measure = () => {
      const options =
        content.current?.querySelectorAll<HTMLElement>('[role="option"]');
      const last = options?.item(options.length - 1);
      // Group padding is not another result: clear the cue as soon as the
      // final option is visible, even if a few padding pixels remain below.
      setMoreBelow(
        last != null &&
          last.getBoundingClientRect().bottom >
            element.getBoundingClientRect().bottom + 2,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (content.current) observer.observe(content.current);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [children]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={viewport}
        id={id}
        role="listbox"
        aria-label={label}
        className="min-h-0 overflow-y-auto overscroll-contain sm:[scrollbar-gutter:stable]"
      >
        <div ref={content}>{children}</div>
      </div>
      {moreBelow ? (
        <p
          aria-hidden="true"
          className="flex shrink-0 items-center justify-center gap-1 border-t border-border bg-surface pt-2 text-xs text-muted"
          data-testid="search-more-below"
        >
          {t("moreBelow")}
          <ChevronDown className="size-3.5" />
        </p>
      ) : null}
    </div>
  );
}
