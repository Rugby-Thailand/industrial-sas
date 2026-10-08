import { Link } from "@/i18n/navigation";

export function PublicInfoNav({
  showSignIn = false,
}: {
  readonly showSignIn?: boolean;
}) {
  return (
    <nav
      aria-label="Application information"
      lang="en"
      className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted"
    >
      <Link
        href="/about"
        className="inline-flex min-h-touch items-center underline-offset-4 hover:underline"
      >
        About
      </Link>
      <Link
        href="/privacy"
        className="inline-flex min-h-touch items-center underline-offset-4 hover:underline"
      >
        Privacy
      </Link>
      <Link
        href="/terms"
        className="inline-flex min-h-touch items-center underline-offset-4 hover:underline"
      >
        Terms
      </Link>
      {showSignIn && (
        <Link
          href="/sign-in"
          className="inline-flex min-h-touch items-center font-medium text-text underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      )}
    </nav>
  );
}
