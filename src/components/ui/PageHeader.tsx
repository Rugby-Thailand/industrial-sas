"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { PageBackLink } from "./PageBackLink";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

export function PageHeader({
  title,
  description,
  children,
  back,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly back?: { href: string; label: string };
}) {
  const t = useTranslations("App");
  const locale = useLocale();

  return (
    <header className="mb-6 space-y-4 py-4 sm:mb-8">
      {back ? <PageBackLink {...back} /> : null}
      <div
        className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-4 ${back ? "" : "min-h-16 sm:min-h-20"}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight text-text sm:text-2xl">
            {title}
          </h1>
          {description === undefined ? null : (
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  title={t("aboutPage")}
                  className="flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-md text-muted outline-none hover:text-text focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Info aria-hidden="true" className="size-4" />
                  <span className="sr-only">{t("aboutPage")}</span>
                </button>
              </DialogTrigger>
              <DialogContent
                className="max-w-lg"
                closeLabel={locale === "th" ? "ปิด" : "Close"}
              >
                <DialogHeader>
                  <DialogTitle>{title}</DialogTitle>
                  <DialogDescription className="mt-3 leading-relaxed">
                    {description}
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          )}
        </div>
        {children}
      </div>
    </header>
  );
}
