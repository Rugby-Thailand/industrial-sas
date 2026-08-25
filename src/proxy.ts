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
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|lottie|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
