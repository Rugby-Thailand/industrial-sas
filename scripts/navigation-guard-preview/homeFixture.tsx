"use client";

import { useSearchParams } from "next/navigation";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { EnvironmentProvider } from "@/components/providers/EnvironmentProvider";
import { HrAccessProvider } from "@/components/providers/HrAccessProvider";
import { DesktopShell } from "@/components/shell/DesktopShell";

export function HomeFixtureShell({
  children,
}: {
  readonly children: ReactNode;
}) {
  const backendConfigured =
    useSearchParams().get("env") !== "backend-unavailable";
  return (
    <EnvironmentProvider
      environment={{ backendConfigured, identityConfigured: true }}
    >
      <HrAccessProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <DesktopShell>{children}</DesktopShell>
        </ThemeProvider>
      </HrAccessProvider>
    </EnvironmentProvider>
  );
}
