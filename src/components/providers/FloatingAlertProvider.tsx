"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CircleAlertIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert";
import { Button } from "@/components/ui/button";

export const WRITE_ERROR_ALERT_DURATION_MS = 10_000;

export type FloatingAlertPayload = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly code?: string;
  readonly dismissLabel: string;
  readonly variant: "destructive" | "warning";
  readonly testId?: string;
  readonly durationMs?: number;
};

type QueuedAlert = FloatingAlertPayload & {
  readonly shownAt: number;
};

type FloatingAlertContextValue = {
  readonly pushAlert: (alert: FloatingAlertPayload) => void;
  readonly dismissAlert: (id: string) => void;
};

const FloatingAlertContext = createContext<FloatingAlertContextValue | null>(
  null,
);

export function FloatingAlertCard({
  alert,
  onDismiss,
}: {
  readonly alert: FloatingAlertPayload;
  readonly onDismiss?: () => void;
}) {
  const Icon =
    alert.variant === "warning" ? TriangleAlertIcon : CircleAlertIcon;

  return (
    <Alert
      variant={alert.variant}
      data-testid={alert.testId}
      className="grid-cols-[0_1fr_auto] shadow-2xl ring-1 ring-border-strong/40 has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr_auto]"
    >
      <Icon aria-hidden="true" />
      <AlertTitle className="line-clamp-none pr-2">{alert.title}</AlertTitle>
      <AlertDescription className="pr-2">
        <p>{alert.body}</p>
        {alert.code === undefined ? null : (
          <code className="rounded bg-raised px-2 py-1 font-mono text-xs text-text">
            {alert.code}
          </code>
        )}
      </AlertDescription>
      {onDismiss === undefined ? null : (
        <AlertAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onDismiss}
            aria-label={alert.dismissLabel}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}

function TimedAlert({
  alert,
  onDismiss,
}: {
  readonly alert: QueuedAlert;
  readonly onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(
      () => onDismiss(alert.id),
      alert.durationMs ?? WRITE_ERROR_ALERT_DURATION_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [alert.durationMs, alert.id, alert.shownAt, onDismiss]);

  return (
    <FloatingAlertCard alert={alert} onDismiss={() => onDismiss(alert.id)} />
  );
}

export function FloatingAlertProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [alerts, setAlerts] = useState<readonly QueuedAlert[]>([]);

  const pushAlert = useCallback((alert: FloatingAlertPayload) => {
    setAlerts((current) => {
      const next = [
        ...current.filter((queuedAlert) => queuedAlert.id !== alert.id),
        { ...alert, shownAt: Date.now() },
      ];

      return next.slice(-4);
    });
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((current) =>
      current.filter((queuedAlert) => queuedAlert.id !== id),
    );
  }, []);

  const value = useMemo(
    () => ({ pushAlert, dismissAlert }),
    [dismissAlert, pushAlert],
  );

  return (
    <FloatingAlertContext.Provider value={value}>
      {children}
      {alerts.length === 0 ? null : (
        <div
          className="pointer-events-none fixed top-20 right-4 z-[100] flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-3"
          data-testid="floating-alert-viewport"
        >
          {alerts.map((alert) => (
            <div className="pointer-events-auto" key={alert.id}>
              <TimedAlert alert={alert} onDismiss={dismissAlert} />
            </div>
          ))}
        </div>
      )}
    </FloatingAlertContext.Provider>
  );
}

export function useFloatingAlerts() {
  return useContext(FloatingAlertContext);
}
