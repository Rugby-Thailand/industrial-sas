"use client";

import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Suspense, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { plannerReturnPath } from "@/lib/auth/returnPath";

interface PublicInfoLinkProps {
  readonly href: "/about" | "/privacy" | "/terms" | "/sign-in";
  readonly children: ReactNode;
  readonly className?: string;
  /** Sign-in already validated this destination on the server. */
  readonly returnTo?: string | null | undefined;
}

function withReturnPath(
  path: PublicInfoLinkProps["href"],
  returnTo: string | undefined,
) {
  return returnTo ? `${path}?${new URLSearchParams({ returnTo })}` : path;
}

function CurrentPublicInfoLink({
  href,
  ...props
}: Omit<PublicInfoLinkProps, "returnTo">) {
  const locale = useLocale();
  const values = useSearchParams().getAll("returnTo");
  const returnTo =
    values.length === 1 ? plannerReturnPath(values[0], locale) : undefined;
  return <Link href={withReturnPath(href, returnTo)} {...props} />;
}

export function PublicInfoLink({
  href,
  returnTo,
  ...props
}: PublicInfoLinkProps) {
  if (returnTo !== undefined)
    return (
      <Link href={withReturnPath(href, returnTo ?? undefined)} {...props} />
    );

  // Public articles stay statically rendered, including crawlable canonical
  // links. Only the link needs the current query after hydration.
  return (
    <Suspense fallback={<Link href={href} {...props} />}>
      <CurrentPublicInfoLink href={href} {...props} />
    </Suspense>
  );
}
