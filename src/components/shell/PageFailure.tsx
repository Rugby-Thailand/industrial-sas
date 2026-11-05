"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import type { Crumb } from "@/components/ui/PageBreadcrumbs";
import { Spinner } from "@/components/ui/spinner";
import { Link } from "@/i18n/navigation";

/**
 * Long enough to see that a retry ran, so one that fails again does not look
 * like a dead button; short enough not to slow the next attempt.
 */
const RETRY_FEEDBACK_MS = 800;

/**
 * A page that could not render: its place (the module page above it, when
 * known), an h1 naming what failed, the likely cause and what else to do,
 * then a retry (primary) and, when there is one, a safe destination
 * (secondary), and what to quote if it keeps failing. Back keeps the real
 * origin; a directly opened failure invents no parent.
 */
export function PageFailure({
  title,
  cause,
  hint,
  breadcrumbs,
  recovery,
  retryLabel,
  onRetry,
  reference,
}: {
  readonly title: string;
  readonly cause: string;
  readonly hint: string;
  readonly breadcrumbs?: readonly Crumb[];
  readonly recovery?: { readonly href: string; readonly label: string };
  readonly retryLabel: string;
  readonly onRetry: () => void;
  /** What a member quotes to their administrator, under the actions. */
  readonly reference?: ReactNode;
}) {
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!retrying) return;
    const timer = window.setTimeout(
      () => setRetrying(false),
      RETRY_FEEDBACK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [retrying]);

  return (
    <div data-testid="route-error" className="w-full max-w-2xl">
      <PageHeader
        title={title}
        backFallbackHref={null}
        {...(breadcrumbs === undefined ? {} : { breadcrumbs })}
      />
      <Notice tone="danger" role="alert" title={cause} body={hint} />
      <div className="mt-4 flex flex-wrap gap-2">
        {/*
         * Busy rather than natively disabled while it runs, so keyboard focus
         * stays on it for the next attempt.
         */}
        <Button
          type="button"
          aria-disabled={retrying || undefined}
          aria-busy={retrying || undefined}
          onClick={() => {
            if (retrying) return;
            setRetrying(true);
            onRetry();
          }}
          data-testid="route-error-retry"
        >
          {retrying ? <Spinner aria-hidden="true" /> : null}
          {retryLabel}
        </Button>
        {recovery === undefined ? null : (
          <Button asChild variant="outline">
            <Link href={recovery.href} data-testid="route-error-recovery">
              {recovery.label}
            </Link>
          </Button>
        )}
      </div>
      {reference}
    </div>
  );
}
