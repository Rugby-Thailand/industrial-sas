"use client";
import { useLayoutEffect, useRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const POSITIONS = {
  sticky: "sticky bottom-0 z-20 -mx-4 mt-6 bg-surface/95 backdrop-blur",
  fixed: "fixed inset-x-0 bottom-0 z-20 m-0 bg-surface shadow-lg",
  responsive:
    "fixed inset-x-0 bottom-0 z-30 m-0 bg-surface shadow-lg md:static md:bottom-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none",
} as const;

/** Fixed modes report their actual height to the nearest PageContainer action inset. */
export function StickyActionBar({
  className,
  placement = "sticky",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly placement?: keyof typeof POSITIONS;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (placement === "sticky") return;
    const bar = ref.current;
    const scope = bar?.closest<HTMLElement>("[data-action-scope]");
    if (!bar || !scope) return;
    const measure = () => {
      const height = bar.getBoundingClientRect().height;
      if (height > 0)
        scope.style.setProperty("--sticky-action-height", `${height}px`);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      scope.style.removeProperty("--sticky-action-height");
    };
  }, [placement]);
  return (
    <div
      ref={ref}
      {...props}
      className={cn(
        "border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
        POSITIONS[placement],
        className,
      )}
    />
  );
}
