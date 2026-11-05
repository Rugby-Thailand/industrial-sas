"use client";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Link } from "@/i18n/navigation";

/**
 * A page that could not render: an h1 naming what failed, what to do next,
 * then a retry (primary) and, when there is one, a safe destination
 * (secondary). Back keeps the real origin; a directly opened failure invents
 * no parent.
 */
export function PageFailure({
  title,
  cause,
  hint,
  recovery,
  retryLabel,
  onRetry,
}: {
  readonly title: string;
  readonly cause: string;
  readonly hint: string;
  readonly recovery?: { readonly href: string; readonly label: string };
  readonly retryLabel: string;
  readonly onRetry: () => void;
}) {
  return (
    <div data-testid="route-error" className="w-full max-w-2xl">
      <PageHeader title={title} backFallbackHref={null} />
      <Notice tone="danger" role="alert" title={cause} body={hint} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={onRetry} data-testid="route-error-retry">
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
    </div>
  );
}
