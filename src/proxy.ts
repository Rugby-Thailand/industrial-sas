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
 * proxy concern in this architecture: Convex is the enforcement point. When
 * Clerk is configured, its handler composes here for session refresh and server
 * auth context; an unconfigured checkout continues through the locale handler
 * so the localized sign-in setup screen remains available.
 */
import { clerkMiddleware } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";

import { routing } from "./i18n/routing";
import { resolveClerkPublishableKey } from "./lib/clerkConfiguration";

const localeMiddleware = createMiddleware(routing);
const clerkConfigured =
  resolveClerkPublishableKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) !==
    undefined && Boolean(process.env.CLERK_SECRET_KEY?.trim());

const clerkProxy = clerkConfigured
  ? clerkMiddleware((_auth, request) => routeRequest(request))
  : undefined;

function routeRequest(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api/") ||
    pathname === "/api" ||
    pathname.startsWith("/trpc/") ||
    pathname === "/trpc" ||
    pathname.startsWith("/__clerk/")
  ) {
    return NextResponse.next();
  }
  return localeMiddleware(request);
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return clerkProxy === undefined
    ? routeRequest(request)
    : clerkProxy(request, event);
}

export const config = {
  /*
   * Everything except Next internals, the API routes, and any path with a file
   * extension. A locale prefix on `/manifest.webmanifest` or `/icons/mark.svg`
   * would 404 the PWA manifest and every icon it names.
   */
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|lottie|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
