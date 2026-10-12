"use client";

import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { useId, useLayoutEffect, useMemo, type ComponentProps } from "react";
import {
  getPathname,
  Link as BaseLink,
  useRouter as useBaseRouter,
} from "./navigationBase";
import { useNavigationProgress } from "@/components/system/NavigationProgress";

function targetsCurrentPath(
  href: ComponentProps<typeof BaseLink>["href"],
  locale: Parameters<typeof getPathname>[0]["locale"],
  pathname: string | null,
) {
  if (pathname === null) return false;
  const destination = getPathname({
    href: typeof href === "string" ? href : (href.pathname ?? pathname),
    locale,
  });
  // Resolve relative, query-only, and fragment hrefs without a browser global
  // so this comparison also works during server rendering.
  return (
    new URL(destination, `https://navigation.invalid${pathname}`).pathname ===
    pathname
  );
}

function LinkProgress({ href, locale }: ComponentProps<typeof BaseLink>) {
  const { pending } = useLinkStatus();
  const currentLocale = useLocale();
  const pathname = usePathname();
  const changesPath = !targetsCurrentPath(
    href,
    locale ?? currentLocale,
    pathname,
  );
  const navigation = useNavigationProgress();
  const id = useId();
  useLayoutEffect(() => {
    navigation?.report(id, pending && changesPath);
    return () => navigation?.report(id, false);
  }, [navigation, id, pending, changesPath]);
  return null;
}

export function Link({
  children,
  onNavigate,
  ...props
}: ComponentProps<typeof BaseLink>) {
  const navigation = useNavigationProgress();
  return (
    <BaseLink
      {...props}
      onNavigate={(event) => {
        let cancelled = false;
        onNavigate?.({
          preventDefault: () => {
            cancelled = true;
            event.preventDefault();
          },
        });
        if (!cancelled) navigation?.prepare(props.replace ? "replace" : "push");
      }}
    >
      {children}
      <LinkProgress href={props.href} locale={props.locale} />
    </BaseLink>
  );
}

export function useRouter() {
  const router = useBaseRouter();
  const navigation = useNavigationProgress();
  const locale = useLocale();
  const pathname = usePathname();
  return useMemo(() => {
    if (!navigation) return router;
    return {
      ...router,
      push: (...args: Parameters<typeof router.push>) => {
        navigation.prepare("push");
        if (targetsCurrentPath(args[0], args[1]?.locale ?? locale, pathname))
          router.push(...args);
        else navigation.run(() => router.push(...args));
      },
      replace: (...args: Parameters<typeof router.replace>) => {
        navigation.prepare("replace");
        if (targetsCurrentPath(args[0], args[1]?.locale ?? locale, pathname))
          router.replace(...args);
        else navigation.run(() => router.replace(...args));
      },
    };
  }, [router, navigation, locale, pathname]);
}
