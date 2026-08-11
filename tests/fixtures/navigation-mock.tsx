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
    replace: () => undefined,
    push: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    prefetch: () => undefined,
  }),
  redirect: () => undefined,
  getPathname: () => currentPathname,
};
