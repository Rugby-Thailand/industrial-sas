"use client";

/**
 * The Convex client, when there is one to construct.
 *
 * With no `NEXT_PUBLIC_CONVEX_URL` this renders its children with **no**
 * `ConvexProvider` above them. That is intentional and it is why every screen
 * decides `BACKEND_MISSING` before it would call `useQuery`: a client
 * constructed against a placeholder URL would retry a nonexistent host forever
 * and report "connecting" while doing it, which is a worse answer than "not
 * configured".
 *
 * The client is created in a `useState` initializer so exactly one exists per
 * mount, and never during the server render — `ConvexReactClient` opens a
 * WebSocket in its constructor.
 *
 * When Clerk is configured, `ConvexProviderWithClerk` is the only auth bridge.
 * It obtains and refreshes Clerk's verified session token; this repository never
 * manufactures a development bearer token or calls `setAuth` itself. With no
 * Clerk key, the plain provider remains so the setup gate can describe the
 * missing identity layer without throwing.
 */
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
