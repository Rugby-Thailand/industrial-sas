"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import { useEffect, useId, useRef, type RefObject } from "react";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarFooter } from "@/components/ui/sidebar";
import { resolveClerkPublishableKey } from "@/lib/clerkConfiguration";
import { cn } from "@/lib/utils";

/**
 * The sidebar footer: one row with the name of the person signed in that
 * opens their account menu. The organization belongs to the header, so it is
 * not repeated here. Nothing renders without a configured identity provider.
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
        "mx-4 border-t border-sidebar-border px-0 py-2",
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
  const nameId = useId();
  const triggerId = useId();
  const trigger = useRef<HTMLDivElement>(null);
  useAccountTrigger(
    trigger,
    triggerId,
    name === undefined ? undefined : nameId,
  );
  return (
    // The whole row is the account menu's target: Clerk's trigger stretches a
    // transparent layer over it, so a tap on the name opens the same menu and
    // the trigger stays the row's one control (its focus ring is the row's).
    <div
      className={cn(
        "relative flex min-h-touch w-full items-center gap-3 rounded-lg px-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-sidebar-ring",
        collapsed && "mx-auto size-12 justify-center px-0",
      )}
      data-testid="sidebar-account"
    >
      <div ref={trigger} className="flex shrink-0">
        <UserButton
          appearance={{
            elements: {
              // `!`: Clerk's own (unlayered) styles otherwise win.
              avatarBox: "size-8!",
              userButtonTrigger:
                "static! shadow-none! after:absolute after:inset-0 after:rounded-lg",
            },
          }}
        />
      </div>
      {name !== undefined ? (
        <span
          id={nameId}
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
 * Adjusts Clerk's account trigger, which mounts and re-renders after
 * hydration, so the row reads as one control:
 *
 * - Clerk names its avatar image "<name>'s logo" in English on every page,
 *   and no localization key reaches it. The trigger already has a localized
 *   name, so the image is decorative.
 * - The person's name is visible on the row the trigger covers, so it joins
 *   the trigger's own localized open/close label (the self-reference keeps
 *   that label current as the menu opens and closes).
 */
function useAccountTrigger(
  ref: RefObject<HTMLElement | null>,
  triggerId: string,
  nameId: string | undefined,
) {
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const decorate = () => {
      // Clerk also titles the image, which would still name it: hide it too.
      for (const image of root.querySelectorAll("img")) {
        if (image.getAttribute("alt") !== "") image.setAttribute("alt", "");
        if (image.getAttribute("aria-hidden") !== "true")
          image.setAttribute("aria-hidden", "true");
      }
      const button = root.querySelector("button");
      if (button === null) return;
      if (button.id !== triggerId) button.id = triggerId;
      if (nameId === undefined) {
        button.removeAttribute("aria-labelledby");
        return;
      }
      const labelledBy = `${triggerId} ${nameId}`;
      if (button.getAttribute("aria-labelledby") !== labelledBy)
        button.setAttribute("aria-labelledby", labelledBy);
    };
    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["alt", "aria-hidden", "aria-labelledby", "id"],
    });
    return () => observer.disconnect();
  }, [ref, triggerId, nameId]);
}
