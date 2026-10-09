"use client";

import { ArrowRight, PackageCheck, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { FG_PATH } from "@/lib/navigation";

type UnitAction = { id: string; label: string; href: string };

const secondaryAction =
  "justify-start px-0 text-[0.8rem] font-medium whitespace-normal text-muted underline hover:text-text";

function PrimaryLink({
  href,
  label,
  arrow = false,
}: {
  href: string;
  label: string;
  arrow?: boolean;
}) {
  return (
    <Button
      asChild
      variant="link"
      size="sm"
      className="max-w-full p-0 no-underline hover:no-underline md:min-h-8"
    >
      <Link href={href} className="group/primary">
        <span className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border border-primary-border bg-primary px-2.5 py-1 text-[0.8rem] whitespace-normal text-primary-foreground group-hover/primary:bg-primary-hover">
          <span>{label}</span>
          {arrow ? <ArrowRight className="size-3.5" aria-hidden /> : null}
        </span>
      </Link>
    </Button>
  );
}

export function PackingCompletion({
  summary,
  units,
  simplePacking,
  productHref,
  onReviewBatch,
  onPrepareAnother,
}: {
  summary: string;
  units: readonly UnitAction[];
  simplePacking: boolean;
  productHref: string;
  onReviewBatch: () => void;
  onPrepareAnother: () => void;
}) {
  const t = useTranslations("FinishedGoods");
  return (
    <div className="max-w-2xl space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <PackageCheck className="size-5 shrink-0 text-success" aria-hidden />
        <p>{summary}</p>
      </div>
      <p className="text-sm text-muted">
        {simplePacking
          ? t("copy.scan-the-package-labels-in-order-then-scan-their-location")
          : t("copy.choose-an-exact-storage-position-for-each-unit")}
      </p>
      <ul className="flex flex-col items-start md:flex-row md:flex-wrap md:items-center md:gap-x-4">
        {units.map((unit, index) => (
          <li key={unit.id} className="max-w-full">
            {!simplePacking && index === 0 ? (
              <PrimaryLink href={unit.href} label={unit.label} arrow />
            ) : (
              <Button
                asChild
                variant="link"
                size="sm"
                className="max-w-full justify-start gap-1.5 px-0 text-[0.8rem] font-medium whitespace-normal underline"
              >
                <Link href={unit.href}>
                  <span>{unit.label}</span>
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 border-t border-border pt-1">
        {simplePacking ? (
          <PrimaryLink
            href={`${FG_PATH}/scan`}
            label={t("copy.scan-packages")}
          />
        ) : (
          <Button asChild variant="link" size="sm" className={secondaryAction}>
            <Link href={productHref}>{t("copy.product-and-batches")}</Link>
          </Button>
        )}
        <Button
          variant="link"
          size="sm"
          className={secondaryAction}
          onClick={onReviewBatch}
        >
          {t("copy.review-or-edit-this-batch")}
        </Button>
        <Button
          variant="link"
          size="sm"
          className={secondaryAction}
          onClick={onPrepareAnother}
        >
          <Plus className="size-3.5" aria-hidden />
          {t("copy.prepare-another-batch")}
        </Button>
      </div>
    </div>
  );
}
