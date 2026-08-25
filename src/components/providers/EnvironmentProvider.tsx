"use client";

import { createContext, useContext, type ReactNode } from "react";

import { currentAppEnvironment, type AppEnvironment } from "@/lib/environment";

const EnvironmentContext = createContext<AppEnvironment | undefined>(undefined);

export function EnvironmentProvider({
  children,
  environment,
}: {
  readonly children: ReactNode;

  readonly environment?: AppEnvironment;
}) {
  return (
    <EnvironmentContext.Provider value={environment ?? currentAppEnvironment()}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useAppEnvironment(): AppEnvironment {
  return useContext(EnvironmentContext) ?? currentAppEnvironment();
}
