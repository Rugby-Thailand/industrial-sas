/**
 * Routing stand-ins for the visual fixture: the shell reads the current
 * path, and the language selector "navigates" by updating the fixture URL.
 * Nothing leaves the page.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";

export const usePathname = () => "/ai-usage";
export const getPathname = ({ href }: { href: string }) => href;
export const redirect = () => undefined;

function replaceLocale(options?: { locale?: string }) {
  if (!options?.locale) return;
  const url = new URL(window.location.href);
  url.searchParams.set("locale", options.locale);
  window.location.assign(url);
}
const router = Object.freeze({
  push: (_href: string, options?: { locale?: string }) =>
    replaceLocale(options),
  replace: (_href: string, options?: { locale?: string }) =>
    replaceLocale(options),
  prefetch: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
});
export const useRouter = () => router;

export function Link({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly href: string;
  readonly children?: ReactNode;
  readonly prefetch?: boolean;
}) {
  const { prefetch: _prefetch, ...rest } = props as typeof props & {
    prefetch?: boolean;
  };
  return (
    <a
      {...rest}
      href={`#${href}`}
      onClick={(event) => {
        event.preventDefault();
        rest.onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}
