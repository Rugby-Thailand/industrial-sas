"use client";
import { usePathname } from "@/i18n/navigation";
import { HomeFixtureShell } from "./homeFixture";
import { useEffect, useState, type ReactNode } from "react";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import {
  NavigationContent,
  NavigationProgressProvider,
} from "@/components/system/NavigationProgress";

export function Shell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  // A rendered heading can still be server HTML. Publish readiness in a
  // subsequent commit, after the initial passive effects attach Next's native
  // history listeners, before tests issue Back on a freshly reloaded document.
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const marker = (
    <span hidden data-testid="navigation-ready" data-ready={ready} />
  );
  if (
    pathname === "/dashboard" ||
    pathname === "/master-data/storage-layouts"
  ) {
    return (
      <HomeFixtureShell>
        {marker}
        {children}
      </HomeFixtureShell>
    );
  }
  // Match Pattern: progress/tracker outside the guard, with content inside it.
  return (
    <NavigationProgressProvider>
      <NavigationGuardProvider>
        <NavigationContent>
          <div className="navigation-fixture">
            {marker}
            {children}
          </div>
        </NavigationContent>
      </NavigationGuardProvider>
    </NavigationProgressProvider>
  );
}
