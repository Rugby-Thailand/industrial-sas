/**
 * Locale negotiation, and nothing else.
 *
 * Named `proxy.ts` rather than `middleware.ts`: Next.js 16 deprecates the
 * `middleware` file convention in favour of `proxy`, and the deprecated name
 * warns on every build. The contract is unchanged — one default export, run
 * before the route.
 *
 * It resolves the active locale before the first render, which is
 * what `INV-0010-05` asks for: a Thai operator's first paint is already Thai,
 * not English replaced a frame later. It reads the URL segment first, then the
 * `NEXT_LOCALE` cookie (the user's own previous choice), then `Accept-Language`,
 * and falls back to Thai.
 *
 * It deliberately performs **no authorization**. Route protection is not a
 * proxy concern in this architecture: the browser is untrusted (plan §6.1)
 * and Convex is the enforcement point, so a middleware that redirected on a
 * client-readable signal would be usability at best and a false sense of
 * security at worst. When Clerk is configured, its own handler composes here for
 * session refresh — still not for authorization.
 */
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  /*
   * Everything except Next internals, the API routes, and any path with a file
   * extension. A locale prefix on `/manifest.webmanifest` or `/icons/mark.svg`
   * would 404 the PWA manifest and every icon it names.
   */
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
