"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentProps,
} from "react";
import { Link } from "@/i18n/navigation";
import { guardedNavigate, registerLinkNavigation } from "@/lib/navigationGuard";

/** Warm visible destinations, including their page code, before a menu tap.
 * Default prefetch stops at the desktop loading boundary on dynamic routes.
 * Waiting for hover leaves fast clicks and touch navigation on the cold path.
 *
 * `navigate` replaces the Link's own push for a plain click (the mobile
 * drawer): the shell first consumes the drawer's history entry, then routes.
 * Closing the drawer in the same click would traverse while the push is
 * pending, and Next's restore of the origin would cancel it. Modified clicks
 * keep native behavior; the unsaved-work guard requests the same transition.
 */
export function SidebarNavigationLink({
  prefetch = true,
  navigate,
  onNavigate,
  ref,
  ...props
}: ComponentProps<typeof Link> & {
  readonly navigate?: (() => void) | undefined;
}) {
  const latest = useRef(navigate);
  useLayoutEffect(() => {
    latest.current = navigate;
  });
  const handoff = navigate !== undefined;
  const transition = useCallback(() => latest.current?.(), []);
  const attach = useCallback(
    (node: HTMLAnchorElement | null) => {
      const release =
        node !== null && handoff
          ? registerLinkNavigation(node, transition)
          : undefined;
      const cleanup = typeof ref === "function" ? ref(node) : undefined;
      if (ref && typeof ref !== "function") ref.current = node;
      return () => {
        release?.();
        if (typeof ref === "function") {
          if (typeof cleanup === "function") cleanup();
          else ref(null);
        } else if (ref) ref.current = null;
      };
    },
    [handoff, ref, transition],
  );
  return (
    <Link
      {...props}
      ref={attach}
      prefetch={prefetch}
      onNavigate={(event) => {
        let cancelled = false;
        onNavigate?.({
          preventDefault: () => {
            cancelled = true;
            event.preventDefault();
          },
        });
        if (cancelled || !handoff) return;
        event.preventDefault();
        guardedNavigate(transition);
      }}
    />
  );
}
