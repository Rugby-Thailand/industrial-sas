import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  useSearchControls,
  type SearchMode,
} from "@/components/shell/search/GlobalSearchProvider";
import {
  useSheetHandoff,
  type SheetCompletionHandle,
} from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import { usePathname } from "@/i18n/navigation";

/**
 * Search chosen inside the mobile drawer opens only once the drawer has
 * consumed its own history entry and finished closing, from the header's
 * menu button, so the dialog never stacks on the sheet or pushes its entry
 * before the drawer's native Back has popped, and Escape returns to a
 * connected control. The request is held for that one close: reopening the
 * drawer, a route change, a different organization, warehouse or signed-in
 * actor, or leaving the phone layout drops it, so an unrelated later close
 * never opens a delayed Search.
 *
 * `request` replaces the sidebar search trigger's direct open on phones;
 * `onDrawerCloseAutoFocus` is the drawer's close-focus handler, and `drawer`
 * the drawer's completion handle.
 */
export function useDrawerSearchHandoff(
  menuOpener: RefObject<HTMLButtonElement | null>,
  drawer: RefObject<SheetCompletionHandle | null>,
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
  const latestContext = useRef(context);
  useLayoutEffect(() => {
    latestContext.current = context;
  });
  const { handOff, cancel, closeFocus } = useSheetHandoff(drawer, () =>
    setOpenMobile(false),
  );

  useEffect(() => {
    if (openMobile) cancel();
  }, [openMobile, cancel]);
  useEffect(() => cancel, [isMobile, context, cancel]);

  const request = useCallback(
    (mode: SearchMode) => {
      handOff(() => {
        // A request made for another route or workspace never opens here.
        if (controls === null || latestContext.current !== context) return;
        const opener = menuOpener.current;
        if (opener?.isConnected) opener.focus();
        controls.open(mode);
      });
    },
    [context, controls, handOff, menuOpener],
  );
  return { request, onDrawerCloseAutoFocus: closeFocus };
}
