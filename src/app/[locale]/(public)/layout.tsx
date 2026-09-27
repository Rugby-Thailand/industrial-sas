import type { ReactNode } from "react";
import { PublicInfoNav } from "@/components/system/PublicInfoNav";
import { Link } from "@/i18n/navigation";

export default function PublicInfoLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div lang="en" className="mx-auto min-h-dvh max-w-3xl px-6 py-8 sm:py-12">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <Link href="/about" className="text-lg font-semibold">
          Thai Property AI
        </Link>
        <PublicInfoNav showSignIn />
      </header>
      <main className="space-y-6 leading-7 [&_a]:underline [&_a]:underline-offset-4 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-3 [&_ul]:pl-6">
        {children}
      </main>
    </div>
  );
}
