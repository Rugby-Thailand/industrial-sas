"use client";

import { useConvex } from "convex/react";
import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
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
import { useObservability } from "@/components/providers/ObservabilityProvider";
import { createConnectionDiagnostics } from "@/lib/observability/connectionDiagnostics";
import { nullObservabilityPort } from "@/lib/observability/port";
import { guardedNavigate } from "@/lib/navigationGuard";

/** A first connection may take a while; a dropped one usually returns fast. */
export const FIRST_CONNECTION_GRACE_MS = 8_000;
export const RECONNECTION_GRACE_MS = 4_000;

type ConvexClient = ReturnType<typeof useConvex>;

/**
 * The backend link as one comparable value from the shell's one Convex
 * subscription: `"none"` without a client, `"up"` while connected, `"first"`
 * before the first connection, and `"down:<n>"` after the n-th connection
 * dropped (each outage is its own value), suffixed `"+w"` while a mutation
 * is unconfirmed.
 */
function useLinkSnapshot(
  client: ConvexClient | undefined,
  diagnostics: ReturnType<typeof createConnectionDiagnostics> | null,
): string {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!client) return () => {};
      if (!diagnostics)
        return client.subscribeToConnectionState(() => notify());
      const sample = () => diagnostics.observe(client.connectionState());
      sample();
      const unsubscribe = client.subscribeToConnectionState(() => {
        sample();
        notify();
      });
      document.addEventListener("visibilitychange", diagnostics.sampleBrowser);
      window.addEventListener("offline", diagnostics.sampleBrowser);
      return () => {
        unsubscribe();
        document.removeEventListener(
          "visibilitychange",
          diagnostics.sampleBrowser,
        );
        window.removeEventListener("offline", diagnostics.sampleBrowser);
      };
    },
    [client, diagnostics],
  );
  const read = useCallback(() => {
    if (client === undefined) return "none";
    const state = client.connectionState();
    const episode = state.isWebSocketConnected
      ? "up"
      : state.hasEverConnected
        ? `down:${state.connectionCount}`
        : "first";
    return (state.inflightMutations ?? 0) > 0 ? `${episode}+w` : episode;
  }, [client]);
  return useSyncExternalStore(subscribe, read, () => "none");
}

const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};
const isOffline = () => navigator.onLine === false;
const useBrowserOffline = () =>
  useSyncExternalStore(subscribeOnline, isOffline, () => false);

/** Defer only new notices while hidden and through the first seconds back.
 * The stale-data signal keeps its original deadline throughout.
 */
function useForegroundStall(): ConnectionStall {
  const stall = useConnectionStall();
  const [view, setView] = useState<{
    deferred: boolean;
    shown: ConnectionStall;
  }>({
    deferred: false,
    shown: null,
  });

  useEffect(() => {
    let timer: number | undefined;
    const onVisibility = () => {
      window.clearTimeout(timer);
      setView((current) =>
        current.deferred ? current : { ...current, deferred: true },
      );
      if (document.visibilityState === "visible") {
        timer = window.setTimeout(() => {
          setView((current) => ({ ...current, deferred: false }));
        }, RECONNECTION_GRACE_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "hidden") onVisibility();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // An announced outage stays announced across hiding, until the socket recovers.
  const shown = view.deferred && view.shown !== stall ? null : stall;
  if (view.shown !== shown) setView({ ...view, shown });
  return shown;
}

/** What the shell's reload action needs, read from the same subscription. */
interface ReloadSafety {
  readonly writesPending: boolean;
  /** Read at the moment of reloading, including after a draft prompt. */
  readonly canReload: () => boolean;
}
const ReloadSafetyContext = createContext<ReloadSafety>({
  writesPending: false,
  canReload: () => !isOffline(),
});

/**
 * Decides, for the whole shell, when the backend cannot be reached: the
 * first connection has not opened after 8 s, or an open one has been down
 * for 4 s. This marks stale data independently of when
 * the visible shell announces a reconnect.
 */
export function ConnectionStallProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  // `useConvex` returns undefined (despite its type) when no backend is set.
  const client = useConvex() as ConvexClient | undefined;
  const port = useObservability();
  const diagnostics = useMemo(
    () =>
      client && port !== nullObservabilityPort
        ? createConnectionDiagnostics(
            port,
            FIRST_CONNECTION_GRACE_MS,
            RECONNECTION_GRACE_MS,
          )
        : null,
    [client, port],
  );
  const snapshot = useLinkSnapshot(client, diagnostics);
  const writesPending = snapshot.endsWith("+w");
  const episode = writesPending ? snapshot.slice(0, -2) : snapshot;
  const [stalled, setStalled] = useState<string | null>(null);

  useEffect(() => {
    if (episode === "up" || episode === "none") return;
    const timer = window.setTimeout(
      () => {
        diagnostics?.stalled();
        setStalled(episode);
      },
      episode === "first" ? FIRST_CONNECTION_GRACE_MS : RECONNECTION_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [episode, diagnostics]);

  const safety = useMemo<ReloadSafety>(
    () => ({
      writesPending,
      canReload: () =>
        !isOffline() &&
        (client?.connectionState().inflightMutations ?? 0) === 0,
    }),
    [client, writesPending],
  );
  const stall: ConnectionStall =
    stalled !== episode ? null : episode === "first" ? "first" : "dropped";
  return (
    <ConnectionStallContext value={stall}>
      <ReloadSafetyContext value={safety}>{children}</ReloadSafetyContext>
    </ConnectionStallContext>
  );
}

/**
 * One compact strip, flush below the shell's navigation controls, while the
 * connection has stalled. Before the first connection nothing has loaded,
 * so only a dropped connection says the data shown may be out of date. Its
 * text is the one polite announcement per outage: the live region stays
 * mounted and holds no controls, and waiting presenters below it stay quiet.
 * Convex reconnects by itself; reloading is a secondary way out that waits
 * for unconfirmed saves and is omitted while the browser is offline. If the
 * reload button disappears while focused, focus moves to `focusFallbackId`.
 * Back in the foreground, it gives the link a fresh grace period first.
 */
export function ConnectionNotice({
  focusFallbackId,
}: {
  readonly focusFallbackId?: string;
}) {
  const t = useTranslations("App");
  const stall = useForegroundStall();
  const shown = stall !== null;
  return (
    <div
      {...(shown ? { "data-testid": "connection-notice" } : {})}
      className={
        shown
          ? "-mx-3 mt-2 -mb-2 flex flex-wrap items-center gap-x-3 border-t border-warning/40 bg-warning-surface px-3 py-0.5 lg:-mx-6 lg:px-6"
          : undefined
      }
    >
      <div
        role="status"
        aria-live="polite"
        className={
          shown
            ? "flex min-w-0 flex-[1_1_12rem] items-start gap-2 py-0.5 text-sm leading-5"
            : undefined
        }
      >
        {shown ? (
          <>
            <WifiOff
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            <p className="min-w-0 wrap-anywhere">
              <span className="font-semibold text-warning">
                {t(stall === "first" ? "connectionFirst" : "connectionLost")}
              </span>{" "}
              <span className="text-text">
                {t(
                  stall === "first"
                    ? "connectionFirstHint"
                    : "connectionLostHint",
                )}
              </span>
            </p>
          </>
        ) : null}
      </div>
      {/* An open modal can hide this slot before the action appears. */}
      <div>
        {shown ? <ReloadAction focusFallbackId={focusFallbackId} /> : null}
      </div>
    </div>
  );
}

function ReloadAction({
  focusFallbackId,
}: {
  readonly focusFallbackId: string | undefined;
}) {
  const t = useTranslations("App");
  const { writesPending, canReload } = useContext(ReloadSafetyContext);
  const offline = useBrowserOffline();
  const reasonId = useId();
  const fallback = useRef(focusFallbackId);
  useLayoutEffect(() => {
    fallback.current = focusFallbackId;
  });
  // A stable ref callback: its cleanup runs only as the button unmounts,
  // before the node leaves the document, so focus has not dropped yet.
  const keepFocus = useCallback((node: HTMLButtonElement | null) => {
    if (node === null) return;
    return () => {
      if (document.activeElement !== node || fallback.current === undefined)
        return;
      document.getElementById(fallback.current)?.focus({ preventScroll: true });
    };
  }, []);

  if (offline)
    return <p className="py-1.5 text-sm text-muted">{t("reloadOffline")}</p>;
  return (
    <>
      <Button
        ref={keepFocus}
        type="button"
        variant="outline"
        size="sm"
        {...(writesPending
          ? { "aria-disabled": true, "aria-describedby": reasonId }
          : {})}
        onClick={() => {
          if (!canReload()) return;
          guardedNavigate(() => window.location.reload(), {
            isValid: canReload,
          });
        }}
      >
        {t(writesPending ? "reloadPending" : "reloadPage")}
      </Button>
      {writesPending ? (
        <span id={reasonId} className="sr-only">
          {t("reloadWaitForSave")}
        </span>
      ) : null}
    </>
  );
}
