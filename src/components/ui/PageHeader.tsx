"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageBackLink } from "./PageBackLink";
import { IconButton } from "./IconButton";
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
  helpText,
  description,
  summary,
  children,
  back,
}: {
  readonly title: string;
  /** Longer reference help remains available without crowding the page. */
  readonly helpText?: string;
  /** @deprecated Use helpText for dialog help or summary for visible copy. */
  readonly description?: string;
  /** Concise supporting text for the current task. */
  readonly summary?: string;
  readonly children?: ReactNode;
  readonly back?: { href: string; label: string };
}) {
  const resolvedHelpText = helpText ?? description;
  return (
    <header className="mb-6 space-y-3">
      {back ? <PageBackLink {...back} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex min-h-touch items-center gap-2">
            <h1 className="min-w-0 text-2xl leading-8 font-semibold tracking-tight break-words text-text">
              {title}
            </h1>
            {resolvedHelpText === undefined ? null : (
              <PageHelp title={title} description={resolvedHelpText} />
            )}
          </div>
          {summary ? (
            <p className="mt-1 max-w-prose text-sm leading-5 text-muted">
              {summary}
            </p>
          ) : null}
        </div>
        {children ? (
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {children}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function PageHelp({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const t = useTranslations("App");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <IconButton
          variant="ghost"
          label={t("aboutPage")}
          className="text-muted"
        >
          <Info aria-hidden="true" className="size-4" />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="max-w-lg" closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="mt-3 leading-relaxed">
            {description}
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
