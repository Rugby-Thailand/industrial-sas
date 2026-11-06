"use client";

import { useConvex } from "convex/react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  ConnectionStallContext,
  useConnectionStall,
  type ConnectionStall,
} from "@/components/system/connectionStall";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { guardedNavigate } from "@/lib/navigationGuard";

/** A first connection may take a while; a dropped one usually returns fast. */
export const FIRST_CONNECTION_GRACE_MS = 8_000;
export const RECONNECTION_GRACE_MS = 4_000;

/**
 * The backend link as one comparable value: `"none"` without a Convex client,
 * `"up"` while connected, `"first"` before the first connection, and
 * `"down:<n>"` after the n-th connection dropped. Each outage is its own value.
 */
function useConnectionEpisode(): string {
  // `useConvex` returns undefined (despite its type) when no backend is set.
  const client = useConvex() as ReturnType<typeof useConvex> | undefined;
  const subscribe = useCallback(
    (notify: () => void) =>
      client === undefined
        ? () => {}
        : client.subscribeToConnectionState(() => notify()),
    [client],
  );
  const read = useCallback(() => {
    if (client === undefined) return "none";
    const state = client.connectionState();
    if (state.isWebSocketConnected) return "up";
    return state.hasEverConnected ? `down:${state.connectionCount}` : "first";
  }, [client]);
  return useSyncExternalStore(subscribe, read, () => "none");
}

/**
 * Decides, for the whole shell, when the backend cannot be reached: the
 * first connection has not opened after 8 s, or an open one has been down
 * for 4 s. A normal load or a brief blip never counts. The notice below and
 * the loading presenters read the same answer, so they never disagree.
 */
export function ConnectionStallProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const episode = useConnectionEpisode();
  const [stalled, setStalled] = useState<string | null>(null);

  useEffect(() => {
    if (episode === "up" || episode === "none") return;
    const timer = window.setTimeout(
      () => setStalled(episode),
      episode === "first" ? FIRST_CONNECTION_GRACE_MS : RECONNECTION_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [episode]);

  const stall: ConnectionStall =
    stalled !== episode ? null : episode === "first" ? "first" : "dropped";
  return (
    <ConnectionStallContext value={stall}>{children}</ConnectionStallContext>
  );
}

/**
 * Says so, without blocking the page, while the connection has stalled.
 * Before the first connection nothing has loaded, so only a dropped
 * connection warns that the data shown may be out of date. This is the one
 * announcement: waiting presenters below it stay quiet.
 */
export function ConnectionNotice() {
  const t = useTranslations("App");
  const stall = useConnectionStall();

  if (stall === null) return null;
  return (
    <Notice
      tone="warning"
      title={t("connectionLost")}
      body={t(stall === "first" ? "connectionFirstHint" : "connectionLostHint")}
      testId="connection-notice"
      className="mt-2 mb-1"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => guardedNavigate(() => window.location.reload())}
      >
        {t("reloadPage")}
      </Button>
    </Notice>
  );
}
