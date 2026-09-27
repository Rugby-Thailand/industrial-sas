"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./breadcrumb";

export type Crumb = { readonly label: string; readonly href: string };

/** Ancestors link upward; the current page closes the trail. Phones keep one line: … › parent › current. */
export function PageBreadcrumbs({
  trail,
  current,
}: {
  trail: readonly Crumb[];
  current: string;
}) {
  const t = useTranslations("App");
  const collapsed = trail.length > 1;
  return (
    <Breadcrumb aria-label={t("breadcrumb")}>
      <BreadcrumbList className="flex-nowrap gap-1 text-xs sm:gap-1.5 sm:text-sm">
        {collapsed && (
          <>
            <BreadcrumbItem className="sm:hidden">
              <BreadcrumbEllipsis className="size-4" />
            </BreadcrumbItem>
            <BreadcrumbSeparator className="sm:hidden" />
          </>
        )}
        {trail.map((crumb, index) => {
          const hiddenOnPhone = index < trail.length - 1;
          return (
            <Fragment key={`${crumb.href}:${index}`}>
              <BreadcrumbItem
                className={cn(
                  "min-w-0",
                  hiddenOnPhone && "hidden sm:inline-flex",
                )}
              >
                <BreadcrumbLink
                  asChild
                  className="block max-w-40 truncate sm:max-w-60"
                >
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator
                className={cn(hiddenOnPhone && "hidden sm:inline-flex")}
              />
            </Fragment>
          );
        })}
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="block truncate">{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
