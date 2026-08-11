"use client";

/**
 * The connectivity badge that appears in both shells.
 *
 * Split in two on purpose. `ConnectionBadge` is pure presentation over a
 * `ConnectionStatus` and can be rendered in a test for all five states without a
 * Convex client. `ConnectionIndicator` decides which status applies, and only
 * mounts the subscriber when there is a client to subscribe to —
 * `useConvexConnectionState` throws outside a `ConvexProvider`, and an
 * unconfigured machine has none.
 *
 * The status is live: `subscribeToConnectionState` fires on every transition, so
 * a dropped warehouse access point changes the badge without a reload. That is
 * the point of putting it in the shell chrome rather than on one screen.
 */
import { useConvexConnectionState } from "convex/react";
import { useTranslations } from "next-intl";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import {
  classifyConnection,
  type ConnectionStatus,
} from "@/lib/convex/connection";

const TONES: Readonly<Record<ConnectionStatus, BadgeTone>> = {
  CONNECTED: "success",
  CONNECTING: "pending",
  DISCONNECTED: "danger",
  NOT_CONFIGURED: "warning",
  PREVIEW: "accent",
};

const LABEL_KEYS: Readonly<Record<ConnectionStatus, string>> = {
  CONNECTED: "connected",
  CONNECTING: "connecting",
  DISCONNECTED: "disconnected",
  NOT_CONFIGURED: "notConfigured",
  PREVIEW: "preview",
};

const HINT_KEYS: Readonly<Record<ConnectionStatus, string>> = {
  CONNECTED: "connectedHint",
  CONNECTING: "connectingHint",
  DISCONNECTED: "disconnectedHint",
  NOT_CONFIGURED: "notConfiguredHint",
  PREVIEW: "previewHint",
};

export function ConnectionBadge({
  status,
}: {
  readonly status: ConnectionStatus;
}) {
  const t = useTranslations("Connection");
  return (
    <span className="inline-flex items-center gap-2">
      <span className="sr-only">{t("label")}</span>
      <StatusBadge
        tone={TONES[status]}
        label={t(LABEL_KEYS[status])}
        title={t(HINT_KEYS[status])}
      />
    </span>
  );
}

/** Subscribes to the live socket state. Only mounted when a client exists. */
function LiveConnectionBadge() {
  const environment = useAppEnvironment();
  const connectionState = useConvexConnectionState();
  return (
    <ConnectionBadge
      status={classifyConnection(environment, {
        isWebSocketConnected: connectionState.isWebSocketConnected,
        hasEverConnected: connectionState.hasEverConnected,
      })}
    />
  );
}

export function ConnectionIndicator() {
  const environment = useAppEnvironment();
  if (environment.previewMode || !environment.backendConfigured) {
    return (
      <ConnectionBadge status={classifyConnection(environment, undefined)} />
    );
  }
  return <LiveConnectionBadge />;
}
