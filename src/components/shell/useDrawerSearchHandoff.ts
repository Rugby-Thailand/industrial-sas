import { useCallback, useEffect, useRef, type RefObject } from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  useSearchControls,
  type SearchMode,
} from "@/components/shell/search/GlobalSearchProvider";
import { useSidebar } from "@/components/ui/sidebar";
import { usePathname } from "@/i18n/navigation";

/**
 * Search chosen inside the mobile drawer opens only once the drawer has
 * finished closing, from the header's menu button, so the dialog never
 * stacks on the sheet and Escape returns to a connected control. The
 * request is held for that one close: reopening the drawer, a route change,
 * a different organization, warehouse or signed-in actor, or leaving the
 * phone layout drops it, so an unrelated later close never opens a delayed
 * Search.
 *
 * `request` replaces the sidebar search trigger's direct open on phones;
 * `onDrawerCloseAutoFocus` is the drawer's close-focus handler.
 */
export function useDrawerSearchHandoff(
  menuOpener: RefObject<HTMLButtonElement | null>,
) {
  const controls = useSearchControls();
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const workspace = useWorkspace();
  const hr = useHrAccess();
  // One primitive for the route and workspace the request was made in.
  const context = JSON.stringify([
    pathname,
    workspace.organization?.id ?? null,
    workspace.selectedWarehouseId ?? null,
    hr.identityKey ?? null,
  ]);
  const queued = useRef<{
    readonly mode: SearchMode;
    readonly context: string;
  } | null>(null);

  useEffect(() => {
    if (openMobile) queued.current = null;
  }, [openMobile]);
  useEffect(
    () => () => {
      queued.current = null;
    },
    [isMobile, context],
  );

  const request = useCallback(
    (mode: SearchMode) => {
      queued.current = { mode, context };
      setOpenMobile(false);
    },
    [context, setOpenMobile],
  );
  const onDrawerCloseAutoFocus = useCallback(
    (event: Event) => {
      const pending = queued.current;
      queued.current = null;
      // A request made for another route or workspace never opens here.
      if (pending === null || pending.context !== context) return;
      if (controls === null) return;
      const opener = menuOpener.current;
      if (opener?.isConnected) {
        event.preventDefault();
        opener.focus();
      }
      controls.open(pending.mode);
    },
    [context, controls, menuOpener],
  );
  return { request, onDrawerCloseAutoFocus };
}
