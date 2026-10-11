"use client";

import { useState, type ComponentProps } from "react";
import { Link } from "@/i18n/navigation";

/** Fetch the full dynamic route when the user points to or focuses a destination. */
export function SidebarNavigationLink(props: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intent ? true : undefined}
      onPointerEnter={(event) => {
        setIntent(true);
        props.onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        setIntent(true);
        props.onFocus?.(event);
      }}
      onTouchStart={(event) => {
        setIntent(true);
        props.onTouchStart?.(event);
      }}
    />
  );
}
