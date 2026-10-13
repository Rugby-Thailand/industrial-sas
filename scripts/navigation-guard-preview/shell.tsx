"use client";
import type { ReactNode } from "react";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import {
  NavigationContent,
  NavigationProgressProvider,
} from "@/components/system/NavigationProgress";

export function Shell({ children }: { readonly children: ReactNode }) {
  // Match Pattern: progress/tracker outside the guard, with content inside it.
  return (
    <NavigationProgressProvider>
      <NavigationGuardProvider>
        <NavigationContent>{children}</NavigationContent>
      </NavigationGuardProvider>
    </NavigationProgressProvider>
  );
}
