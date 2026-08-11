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
 * No `setAuth` call appears here. Authentication is Clerk's
 * (`ADR-0001` §2), and wiring `setAuth` to anything other than a real, verified
 * token fetcher is the one thing this file must never do: Convex would send
 * whatever it was handed as a bearer token, and `resolveTenantContext` would be
 * deciding tenancy from it. Until `@clerk/nextjs` is configured, the honest state
 * is an unauthenticated client whose every tenant call is denied by the server.
 */
import { ConvexProvider, ConvexReactClient } from "convex/react";
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
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
