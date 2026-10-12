"use client";

import { useAuth, useReverification } from "@clerk/nextjs";
import { ConvexHttpClient } from "convex/browser";
import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { RefValue } from "@/lib/convex/clientRef";
import { hrRefs } from "@/lib/convex/hrApi";
import { HR_CODES } from "@/lib/navigation";
import { guardedNavigate, onNavigationIntent } from "@/lib/navigationGuard";

import { formatBusinessDate } from "./format";
import {
  Facts,
  HrGate,
  HrInlineError,
  HrQueryState,
  useHrBack,
} from "./HrShared";
import {
  downloadPrivatePayslip,
  PayslipAccessError,
  payslipReverificationHint,
  requirePayslipOutcome,
} from "./payslipClient";
import { HrStackFirst, useHrCursorStack } from "./HrPagedList";

type List = Extract<RefValue<typeof hrRefs.payslips>, { ok: true }>;
type Metadata = List["items"][number];
type Detail = {
  readonly gross: number;
  readonly deductions: number;
  readonly net: number;
  readonly expiresAt: number;
  readonly policyVersionId: string;
};

export function HrPayslipsScreen({ rowId }: { readonly rowId?: string }) {
  const t = useTranslations("Hr.payslips");
  const back = useHrBack();
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} {...back} />
      <HrGate code={HR_CODES.self}>
        {rowId ? <ExactPayslip rowId={rowId} /> : <PayslipList />}
      </HrGate>
    </>
  );
}
function ExactPayslip({ rowId }: { readonly rowId: string }) {
  const outcome = useQuery(hrRefs.payslipMetadata, { rowId });
  return (
    <HrQueryState outcome={outcome}>
      {() =>
        outcome?.ok ? (
          outcome.value.ok ? (
            <PayslipCard row={outcome.value.item} policy={outcome.value} />
          ) : (
            <PayslipGate code={outcome.value.code} />
          )
        ) : null
      }
    </HrQueryState>
  );
}
function PayslipList() {
  const t = useTranslations("Hr.payslips");
  const [cursors, , nav] = useHrCursorStack("payslips");
  const cursor = cursors.at(-1);
  const outcome = useQuery(hrRefs.payslips, cursor ? { cursor } : {});
  return (
    <HrQueryState outcome={outcome}>
      {() =>
        outcome?.ok ? (
          outcome.value.ok ? (
            <div className="space-y-4">
              {outcome.value.items.length ? (
                <ul className="space-y-3">
                  {outcome.value.items.map((row) => (
                    <li key={row.id}>
                      {outcome.value.ok ? (
                        <PayslipCard row={row} policy={outcome.value} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={t("empty")} />
              )}
              <div className="flex flex-wrap gap-3">
                <HrStackFirst nav={nav} guard={guardedNavigate} />
                <Button
                  variant="outline"
                  disabled={!nav.canPrevious}
                  onClick={() => guardedNavigate(() => nav.previous())}
                >
                  {t("previous")}
                </Button>
                <Button
                  variant="outline"
                  disabled={outcome.value.isDone}
                  onClick={() => {
                    if (outcome.value.ok) {
                      const next = outcome.value.continueCursor;
                      guardedNavigate(() => nav.next(next));
                    }
                  }}
                >
                  {t("next")}
                </Button>
              </div>
            </div>
          ) : (
            <PayslipGate code={outcome.value.code} />
          )
        ) : null
      }
    </HrQueryState>
  );
}
function PayslipGate({ code }: { readonly code: string }) {
  const t = useTranslations("Hr.payslips");
  return code === "POLICY_NOT_ACTIVE" ||
    code === "PAYSLIP_CAPABILITY_UNAVAILABLE" ? (
    <Notice tone="warning" title={t("gate")} body={t("gateHint")} />
  ) : (
    <HrInlineError code={code} />
  );
}
function PayslipCard({
  row,
  policy,
}: {
  readonly row: Metadata;
  readonly policy: Pick<
    List,
    | "verificationMinutes"
    | "policyVersionId"
    | "capabilityAvailable"
    | "policyChangesAt"
  >;
}) {
  const t = useTranslations("Hr.payslips");
  const locale = useLocale();
  const environment = useAppEnvironment();
  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-text">
            {formatBusinessDate(row.from, locale)} –{" "}
            {formatBusinessDate(row.to, locale)}
          </h2>
          <p className="text-sm text-muted">
            {t("paymentDate")}: {formatBusinessDate(row.paymentDate, locale)}
          </p>
        </div>
        <StatusBadge
          tone={row.superseded ? "muted" : "neutral"}
          label={
            row.superseded
              ? t("superseded")
              : t("version", { version: row.version })
          }
        />
      </div>
      {row.superseded ? null : environment.identityConfigured &&
        environment.convexUrl &&
        policy.capabilityAvailable ? (
        <SensitiveStatement row={row} policy={policy} />
      ) : (
        <Notice tone="warning" title={t("gate")} body={t("gateHint")} />
      )}
    </Panel>
  );
}

/** Sensitive reads use isolated HTTP clients: amounts never enter the live query cache. */
function SensitiveStatement({
  row,
  policy,
}: {
  readonly row: Metadata;
  readonly policy: Pick<
    List,
    | "verificationMinutes"
    | "policyVersionId"
    | "capabilityAvailable"
    | "policyChangesAt"
  >;
}) {
  const auth = useAuth();
  const access = useHrAccess();
  const scope = `${access.identityKey ?? ""}:${auth.sessionId ?? ""}:${String(auth.isSignedIn)}:${policy.policyVersionId}:${row.id}:${row.version}`;
  return (
    <SensitiveStatementBody key={scope} row={row} scope={scope} auth={auth} />
  );
}
function SensitiveStatementBody({
  row,
  scope,
  auth,
}: {
  readonly row: Metadata;
  readonly scope: string;
  readonly auth: ReturnType<typeof useAuth>;
}) {
  const t = useTranslations("Hr.payslips");
  const locale = useLocale();
  const { getToken, isSignedIn } = auth;
  const environment = useAppEnvironment();
  const currentScope = useRef(scope);
  const generation = useRef(0);
  const mounted = useRef(true);
  const ticketIntent = useRef<string | null>(null);
  const [entry, setEntry] = useState<{
    scope: string;
    value: Detail;
    until: number;
  } | null>(null);
  const [action, setAction] = useState<{
    scope: string;
    pending: boolean;
    error?: string;
  }>({ scope, pending: false });
  const [clock, setClock] = useState(() => Date.now());
  const pending = action.scope === scope && action.pending;
  const exposed =
    entry?.scope === scope && entry.until > clock && isSignedIn ? entry : null;
  const hide = () => {
    generation.current++;
    setEntry(null);
    setAction({ scope: currentScope.current, pending: false });
  };
  useLayoutEffect(() => {
    currentScope.current = scope;
    generation.current++;
    ticketIntent.current = null;
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    const clear = () => {
      generation.current++;
      setEntry(null);
      setAction({ scope: currentScope.current, pending: false });
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") clear();
    };
    const navigationClick = (event: MouseEvent) => {
      if (event.target instanceof Element) {
        const link = event.target.closest("a[href]");
        if (link && !link.hasAttribute("download")) clear();
      }
    };
    // Hide amounts only once a navigation is permitted; never block it.
    const unregister = onNavigationIntent(clear);
    document.addEventListener("click", navigationClick, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", clear);
    window.addEventListener("popstate", clear);
    const unmount = () => {
      mounted.current = false;
      generation.current++;
      ticketIntent.current = null;
    };
    return () => {
      unmount();
      ticketIntent.current = null;
      unregister();
      document.removeEventListener("click", navigationClick, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("popstate", clear);
    };
  }, []);
  useEffect(() => {
    if (!exposed) return;
    const timer = setTimeout(
      () => {
        generation.current++;
        setEntry(null);
        setAction({
          scope: currentScope.current,
          pending: false,
          error: "EXPIRED",
        });
      },
      Math.max(0, exposed.until - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [exposed]);

  const request = useReverification(
    async (kind: "REVEAL" | "DOWNLOAD", requestId: string) => {
      if (!environment.convexUrl || !isSignedIn)
        throw new PayslipAccessError("DENIED");
      const token = await getToken({ template: "convex", skipCache: true });
      if (!token) throw new PayslipAccessError("DENIED");
      const client = new ConvexHttpClient(environment.convexUrl);
      client.setAuth(token);
      try {
        // Time can advance past a scheduled policy boundary without a reactive DB write.
        const metadata = requirePayslipOutcome(
          await client.query(hrRefs.payslipMetadata, { rowId: row.id }),
        );
        if (!metadata.ok) throw new PayslipAccessError(metadata.code);
        if (!metadata.capabilityAvailable)
          throw new PayslipAccessError("PAYSLIP_CAPABILITY_UNAVAILABLE");
        if (kind === "REVEAL") {
          const detail = requirePayslipOutcome(
            await client.mutation(hrRefs.payslipDetail, {
              requestId,
              rowId: row.id,
            }),
          );
          if (!detail.written) {
            if (detail.error?.code === "REVERIFICATION_REQUIRED")
              return payslipReverificationHint(metadata.verificationMinutes);
            throw new PayslipAccessError(detail.error?.code ?? "DENIED");
          }
          if (
            typeof detail.gross !== "number" ||
            typeof detail.deductions !== "number" ||
            typeof detail.net !== "number" ||
            typeof detail.expiresAt !== "number" ||
            typeof detail.policyVersionId !== "string"
          )
            throw new PayslipAccessError("FAILED");
          if (detail.policyVersionId !== metadata.policyVersionId)
            throw new PayslipAccessError("PAYSLIP_POLICY_CHANGED");
          return {
            kind: "DETAIL" as const,
            detail: {
              gross: detail.gross,
              deductions: detail.deductions,
              net: detail.net,
              expiresAt: detail.expiresAt,
              policyVersionId: detail.policyVersionId,
            },
            metadata,
          };
        }
        const ticket = requirePayslipOutcome(
          await client.mutation(hrRefs.payslipTicket, {
            requestId,
            rowId: row.id,
          }),
        );
        if (!ticket.written) {
          if (ticket.error?.code === "REVERIFICATION_REQUIRED")
            return payslipReverificationHint(metadata.verificationMinutes);
          throw new PayslipAccessError(ticket.error?.code ?? "DENIED");
        }
        const document = requirePayslipOutcome(
          await client.mutation(hrRefs.payslipDocument, {
            requestId: `${requestId}_document`,
            ticketId: ticket.documentId,
          }),
        );
        if (!document.written) {
          if (document.error?.code === "REVERIFICATION_REQUIRED")
            return payslipReverificationHint(metadata.verificationMinutes);
          throw new PayslipAccessError(document.error?.code ?? "DENIED");
        }
        if (
          typeof document.base64 !== "string" ||
          typeof document.sha256 !== "string" ||
          typeof document.expiresAt !== "number" ||
          typeof document.fileName !== "string"
        )
          throw new PayslipAccessError("FAILED");
        if (document.policyVersionId !== metadata.policyVersionId)
          throw new PayslipAccessError("PAYSLIP_POLICY_CHANGED");
        return {
          kind: "DOCUMENT" as const,
          document: {
            base64: document.base64,
            sha256: document.sha256,
            expiresAt: document.expiresAt,
            fileName: document.fileName,
          },
          metadata,
        };
      } finally {
        client.clearAuth();
      }
    },
  );
  const run = async (kind: "REVEAL" | "DOWNLOAD") => {
    if (pending) return;
    const operation = ++generation.current;
    const capturedScope = scope;
    const isCurrent = () =>
      mounted.current &&
      currentScope.current === capturedScope &&
      generation.current === operation &&
      document.visibilityState !== "hidden";
    setEntry(null);
    setAction({ scope: capturedScope, pending: true });
    if (kind === "DOWNLOAD") ticketIntent.current ??= crypto.randomUUID();
    try {
      const result = await request(
        kind,
        ticketIntent.current ?? crypto.randomUUID(),
      );
      if (!isCurrent()) return;
      if ("clerk_error" in result)
        throw new PayslipAccessError("REVERIFICATION_REQUIRED");
      if (result.kind === "DETAIL") {
        const until = Math.min(
          result.detail.expiresAt,
          result.metadata.policyChangesAt ?? Infinity,
        );
        if (until <= Date.now())
          throw new PayslipAccessError("PAYSLIP_TICKET_EXPIRED");
        setClock(Date.now());
        setEntry({ scope: capturedScope, value: result.detail, until });
      } else {
        await downloadPrivatePayslip(result.document, isCurrent);
        ticketIntent.current = null;
      }
      if (isCurrent()) setAction({ scope: capturedScope, pending: false });
    } catch (error) {
      if (!isCurrent()) return;
      setEntry(null);
      if (error instanceof PayslipAccessError) ticketIntent.current = null;
      setAction({
        scope: capturedScope,
        pending: false,
        error: error instanceof PayslipAccessError ? error.code : "FAILED",
      });
    }
  };
  const error = action.scope === scope ? action.error : undefined;
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "THB",
  });
  return (
    <div className="space-y-4">
      {exposed ? (
        <>
          <Facts
            items={[
              {
                label: t("gross"),
                value: money.format(exposed.value.gross / 100),
              },
              {
                label: t("deductions"),
                value: money.format(exposed.value.deductions / 100),
              },
              { label: t("net"), value: money.format(exposed.value.net / 100) },
            ]}
          />
          <p className="text-xs text-muted">{t("expiry")}</p>
        </>
      ) : (
        <p className="font-medium text-muted" data-testid="hr-payslip-masked">
          {t("masked")}
        </p>
      )}
      {error ? (
        <Notice
          tone="warning"
          role="alert"
          title={t(
            error === "PAYSLIP_SOURCE_INTEGRITY_FAILED"
              ? "integrity"
              : error === "PAYSLIP_TICKET_EXPIRED" ||
                  error === "REVERIFICATION_REQUIRED" ||
                  error === "EXPIRED" ||
                  error === "PAYSLIP_POLICY_CHANGED"
                ? "expired"
                : "failed",
          )}
        />
      ) : null}
      <div className="flex flex-wrap gap-3">
        {exposed ? (
          <Button variant="outline" onClick={hide}>
            {t("hide")}
          </Button>
        ) : (
          <Button
            disabled={pending || !isSignedIn}
            onClick={() => void run("REVEAL")}
          >
            {pending ? t("pending") : t("reveal")}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={pending || !isSignedIn}
          onClick={() => void run("DOWNLOAD")}
        >
          {t("download")}
        </Button>
      </div>
    </div>
  );
}
