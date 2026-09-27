"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageBackButton } from "./PageBackButton";
import { PageBreadcrumbs, type Crumb } from "./PageBreadcrumbs";
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
  breadcrumbs,
  showBack = true,
}: {
  readonly title: string;
  /** Longer reference help remains available without crowding the page. */
  readonly helpText?: string;
  /** @deprecated Use helpText for dialog help or summary for visible copy. */
  readonly description?: string;
  /** Concise supporting text for the current task. */
  readonly summary?: string;
  readonly children?: ReactNode;
  /** Pages above this one; top-level (sidebar) pages pass none. */
  readonly breadcrumbs?: readonly Crumb[];
  /** Pages outside the app shell (sign-in) have nowhere to go back to. */
  readonly showBack?: boolean;
}) {
  const resolvedHelpText = helpText ?? description;
  return (
    <header className="mb-6 space-y-3">
      {breadcrumbs?.length ? (
        <PageBreadcrumbs trail={breadcrumbs} current={title} />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex min-h-touch items-center gap-1">
            {showBack ? (
              <PageBackButton fallbackHref={breadcrumbs?.at(-1)?.href ?? "/"} />
            ) : null}
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
