"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import { useEffect, useRef, type RefObject } from "react";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarFooter } from "@/components/ui/sidebar";
import { resolveClerkPublishableKey } from "@/lib/clerkConfiguration";
import { cn } from "@/lib/utils";

/**
 * The sidebar footer: the account menu beside the name of the person signed
 * in. The organization belongs to the header, so it is not repeated here.
 * Nothing renders without a configured identity provider.
 */
export function SidebarAccount({ collapsed }: { readonly collapsed: boolean }) {
  const environment = useAppEnvironment();
  const publishableKey = resolveClerkPublishableKey(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  if (!environment.identityConfigured || !publishableKey) return null;
  return (
    <SidebarFooter
      className={cn(
        "mx-4 border-t border-sidebar-border px-0 py-4",
        collapsed && "mx-2 p-0 py-2",
      )}
    >
      <SignedInAccount collapsed={collapsed} />
    </SidebarFooter>
  );
}

function SignedInAccount({ collapsed }: { readonly collapsed: boolean }) {
  const { isLoaded, user } = useUser();
  const name =
    user?.fullName?.trim() ||
    user?.primaryEmailAddress?.emailAddress ||
    undefined;
  const trigger = useRef<HTMLDivElement>(null);
  useDecorativeImages(trigger);
  return (
    <div
      className={cn(
        "flex min-h-12 items-center gap-3",
        collapsed && "justify-center",
      )}
      data-testid="sidebar-account"
    >
      <div ref={trigger} className="shrink-0">
        <UserButton
          appearance={{
            elements: {
              avatarBox: "size-9",
              userButtonTrigger: "min-h-11 min-w-11 justify-center",
            },
          }}
        />
      </div>
      {name !== undefined ? (
        <span
          className={
            collapsed ? "sr-only" : "min-w-0 truncate text-sm font-medium"
          }
          title={name}
          data-testid="sidebar-account-name"
        >
          {name}
        </span>
      ) : isLoaded || collapsed ? null : (
        <Skeleton
          aria-hidden="true"
          // The default skeleton fill matches the sidebar surface.
          className="h-4 w-32 bg-sidebar-border"
          data-testid="sidebar-account-loading"
        />
      )}
    </div>
  );
}

/**
 * Clerk names its avatar image "<name>'s logo" in English on every page, and
 * no localization key reaches it. The menu button already has a localized
 * name and the person's name sits beside it, so the image is decorative.
 */
function useDecorativeImages(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    // Clerk also titles the image, which would still name it: hide it too.
    const decorate = () => {
      for (const image of root.querySelectorAll("img")) {
        if (image.getAttribute("alt") !== "") image.setAttribute("alt", "");
        if (image.getAttribute("aria-hidden") !== "true")
          image.setAttribute("aria-hidden", "true");
      }
    };
    decorate();
    // Clerk mounts and re-renders the avatar after hydration.
    const observer = new MutationObserver(decorate);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["alt", "aria-hidden"],
    });
    return () => observer.disconnect();
  }, [ref]);
}
