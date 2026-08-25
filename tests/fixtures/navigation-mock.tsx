import type { AnchorHTMLAttributes, ReactNode } from "react";

let currentPathname = "/dashboard";

export const setMockPathname = (pathname: string): void => {
  currentPathname = pathname;
};

export interface ReplaceCall {
  readonly href: string;
  readonly locale?: string;
}

export const routerReplaceCalls: ReplaceCall[] = [];

export const resetRouterCalls = (): void => {
  routerReplaceCalls.length = 0;
};

export const navigationMock = {
  Link: ({
    href,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => currentPathname,
  useRouter: () => ({
    replace: (href: string, options?: { locale?: string }) => {
      routerReplaceCalls.push({
        href,
        ...(options?.locale === undefined ? {} : { locale: options.locale }),
      });
    },
    push: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    prefetch: () => undefined,
  }),
  redirect: () => undefined,
  getPathname: () => currentPathname,
};
