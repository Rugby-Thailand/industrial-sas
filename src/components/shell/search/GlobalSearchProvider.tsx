"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { useRouter } from "@/i18n/navigation";
import {
  destinationHref,
  hasNavigationPermission,
  targetPermissions,
  type DestinationTarget,
} from "@/lib/navigation";
import { guardedNavigate } from "@/lib/navigationGuard";
import type { PageSearchContext } from "@/lib/search/resolveIntent";

import { PageContextSetter } from "./pageContext";
import { SearchDialog } from "./SearchDialog";

export type SearchMode = "SEARCH" | "AI";

interface SearchControls {
  readonly open: (mode: SearchMode) => void;
  /** AI Search is an HR capability; storage-only members never see it. */
  readonly aiAvailable: boolean;
}

const SearchControlsContext = createContext<SearchControls | null>(null);

/** Everything the member may open: storage navigation plus HR grants. */
export function useGrantedPermissions(): readonly string[] {
  const workspace = useWorkspace();
  const hr = useHrAccess();
  const storage = workspace.permissionsReady
    ? workspace.navigationPermissions
    : null;
  const hrGrants = hr.status === "READY" ? hr.permissions : null;
  return useMemo(
    () => [...(storage ?? []), ...(hrGrants ?? [])],
    [storage, hrGrants],
  );
}

/**
 * Global search for the shell: the dialog, the ⌘K / Ctrl+K shortcut, the
 * selected-record context pages publish, and guarded navigation to typed
 * destinations. Nothing is queried until the dialog is open and text typed.
 */
export function GlobalSearchProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const t = useTranslations("Search");
  const router = useRouter();
  const hr = useHrAccess();
  const granted = useGrantedPermissions();
  const [state, setState] = useState<{ open: boolean; mode: SearchMode }>({
    open: false,
    mode: "SEARCH",
  });
  const [pageContext, setPageContext] = useState<PageSearchContext | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");
  const aiAvailable =
    hr.status === "READY" && hr.permissions.includes("hr.self.access");

  const open = useCallback(
    (mode: SearchMode) => setState({ open: true, mode }),
    [],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        setState((current) =>
          current.open ? current : { open: true, mode: "SEARCH" },
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = useCallback(
    (target: DestinationTarget, trail: string) => {
      const href = destinationHref(target);
      // Only app-built, permitted destinations are ever pushed.
      if (
        href === null ||
        !hasNavigationPermission(targetPermissions(target), granted)
      )
        return false;
      setState((current) => ({ ...current, open: false }));
      guardedNavigate(() => {
        setAnnouncement(t("navigating", { trail }));
        router.push(href);
      });
      return true;
    },
    [granted, router, t],
  );

  const controls = useMemo(() => ({ open, aiAvailable }), [aiAvailable, open]);
  return (
    <SearchControlsContext.Provider value={controls}>
      <PageContextSetter.Provider value={setPageContext}>
        {children}
        <SearchDialog
          open={state.open}
          mode={state.mode}
          aiAvailable={aiAvailable}
          granted={granted}
          pageContext={pageContext}
          onOpenChange={(next) =>
            setState((current) => ({ ...current, open: next }))
          }
          onModeChange={(mode) => setState((current) => ({ ...current, mode }))}
          onNavigate={navigate}
        />
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </PageContextSetter.Provider>
    </SearchControlsContext.Provider>
  );
}

export function useSearchControls(): SearchControls | null {
  return useContext(SearchControlsContext);
}
