"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useState, type ReactNode } from "react";

import { useAppEnvironment } from "./EnvironmentProvider";

export function ConvexClientProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const environment = useAppEnvironment();
  const { convexUrl } = environment;
  const [client] = useState(() =>
    convexUrl === undefined ? undefined : new ConvexReactClient(convexUrl),
  );

  if (client === undefined) return <>{children}</>;
  if (environment.identityConfigured) {
    return (
      <ConvexProviderWithClerk client={client} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    );
  }
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
