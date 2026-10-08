import type { ReactNode } from "react";
import { PublicInfoNav } from "@/components/system/PublicInfoNav";
import { Link } from "@/i18n/navigation";

export default function PublicInfoLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div
      lang="en"
      className="mx-auto min-h-dvh max-w-3xl px-4 py-6 sm:px-6 sm:py-8"
    >
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <Link href="/about" className="text-lg font-semibold">
          Thai Property AI
        </Link>
        <PublicInfoNav showSignIn />
      </header>
      <main className="space-y-4 text-sm leading-7 [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
        {children}
      </main>
    </div>
  );
}
