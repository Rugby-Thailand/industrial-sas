import { PublicInfoLink } from "./PublicInfoLink";

export function PublicInfoNav({
  showSignIn = false,
  returnTo,
}: {
  readonly showSignIn?: boolean;
  readonly returnTo?: string | null | undefined;
}) {
  return (
    <nav
      aria-label="Application information"
      lang="en"
      className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted"
    >
      <PublicInfoLink
        returnTo={returnTo}
        href="/about"
        className="inline-flex min-h-touch items-center underline-offset-4 hover:underline"
      >
        About
      </PublicInfoLink>
      <PublicInfoLink
        returnTo={returnTo}
        href="/privacy"
        className="inline-flex min-h-touch items-center underline-offset-4 hover:underline"
      >
        Privacy
      </PublicInfoLink>
      <PublicInfoLink
        returnTo={returnTo}
        href="/terms"
        className="inline-flex min-h-touch items-center underline-offset-4 hover:underline"
      >
        Terms
      </PublicInfoLink>
      {showSignIn && (
        <PublicInfoLink
          returnTo={returnTo}
          href="/sign-in"
          className="inline-flex min-h-touch items-center font-medium text-text underline-offset-4 hover:underline"
        >
          Sign in
        </PublicInfoLink>
      )}
    </nav>
  );
}
