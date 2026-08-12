/**
 * A stand-in for `@/i18n/navigation` in component tests.
 *
 * `next-intl`'s navigation primitives delegate to `next/navigation`, which
 * throws outside a mounted App Router. Mounting one in jsdom would mean
 * rendering a route tree to test a header, so the seam is mocked instead: the
 * shells only need a `Link` that renders an anchor and a `usePathname` that
 * answers the current path.
 *
 * The mock is *not* a no-op. `usePathname` drives the active-link state, which
 * is a real behaviour with a real accessibility contract (`aria-current`), so a
 * test can set the path and assert what the navigation says about it.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";

let currentPathname = "/dashboard";

/** Set the path `usePathname` answers with for subsequent renders. */
export const setMockPathname = (pathname: string): void => {
  currentPathname = pathname;
};

/**
 * Every `router.replace` the tree asked for, in order.
 *
 * Recorded rather than swallowed because one navigation in this application is
 * a behaviour with a contract rather than a side effect: switching language must
 * `replace` **the current path** in the other locale. A mock that returned
 * `undefined` could not tell "stayed on the balances screen in English" apart
 * from "went to the dashboard", and those are the two outcomes the control
 * exists to distinguish.
 */
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
