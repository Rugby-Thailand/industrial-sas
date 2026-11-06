"use client";

import { useConnectionStall } from "@/components/system/connectionStall";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  // While the shell's connection has stalled nothing is on its way, so the
  // placeholder holds still instead of pulsing.
  const waiting = useConnectionStall() !== null;
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-md bg-raised",
        waiting ? undefined : "animate-pulse",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
