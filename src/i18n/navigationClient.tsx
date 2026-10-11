"use client";

import { useLinkStatus } from "next/link";
import { useId, useLayoutEffect, useMemo, type ComponentProps } from "react";
import { Link as BaseLink, useRouter as useBaseRouter } from "./navigationBase";
import { useNavigationProgress } from "@/components/system/NavigationProgress";

function LinkProgress() {
  const { pending } = useLinkStatus();
  const navigation = useNavigationProgress();
  const id = useId();
  useLayoutEffect(() => {
    navigation?.report(id, pending);
    return () => navigation?.report(id, false);
  }, [navigation, id, pending]);
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
      <LinkProgress />
    </BaseLink>
  );
}

export function useRouter() {
  const router = useBaseRouter();
  const navigation = useNavigationProgress();
  return useMemo(() => {
    if (!navigation) return router;
    return {
      ...router,
      push: (...args: Parameters<typeof router.push>) => {
        navigation.prepare("push");
        navigation.run(() => router.push(...args));
      },
      replace: (...args: Parameters<typeof router.replace>) => {
        navigation.prepare("replace");
        navigation.run(() => router.replace(...args));
      },
    };
  }, [router, navigation]);
}
