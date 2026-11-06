"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const COPIED_FEEDBACK_MS = 2000;

/**
 * What a member quotes to their administrator when a page keeps failing: a
 * short reference (in the recorded event too), the page and the time. Copy
 * puts them on the clipboard as one line, with the page's full address for
 * the administrator; without a clipboard it selects the reference so it can
 * be copied by hand.
 */
export function FailureReference({
  reference,
  page,
  address,
  time,
}: {
  readonly reference: string;
  /** The page's name as the member knows it. */
  readonly page: string;
  /** The page's address, without the locale. */
  readonly address: string;
  readonly time: string;
}) {
  const t = useTranslations("Error");
  const labelId = useId();
  const code = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      const where = page === address ? [page] : [page, address];
      await navigator.clipboard.writeText(
        [`${t("reference")} ${reference}`, ...where, time].join(" · "),
      );
      setCopied(true);
    } catch {
      // An insecure origin or a refused permission: copy by hand.
      if (code.current) window.getSelection()?.selectAllChildren(code.current);
    }
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"
      data-testid="route-error-reference"
    >
      <span id={labelId}>{t("reference")}</span>
      {/* Generated on the client: a server-rendered copy may differ. */}
      <code
        ref={code}
        className="rounded bg-raised px-2 py-1 font-mono text-xs text-text select-all"
        data-testid="route-error-reference-code"
        suppressHydrationWarning
      >
        {reference}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void copy()}
        className="text-muted hover:text-text"
        data-testid="route-error-reference-copy"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? t("referenceCopied") : t("copyReference")}
      </Button>
      <span
        className="min-w-0"
        data-testid="route-error-reference-detail"
        suppressHydrationWarning
      >
        {`${page} · ${time}`}
      </span>
      <span role="status" className="sr-only">
        {copied ? t("referenceCopied") : ""}
      </span>
    </div>
  );
}
