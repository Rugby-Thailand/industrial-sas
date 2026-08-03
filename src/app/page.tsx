/**
 * Scaffold landing page.
 *
 * Its only job is to prove the toolchain builds and renders with no secrets and
 * no vendor configuration present. It must not grow domain behaviour; the real
 * shells live under `src/app/[locale]/(desktop)` and `(handheld)` later.
 */
export default function ScaffoldStatusPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 p-6">
      <p className="w-fit rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-semibold tracking-wide text-amber-900 uppercase dark:bg-amber-950 dark:text-amber-100">
        Scaffold — not a working application
      </p>

      <h1 className="text-3xl font-bold tracking-tight">Industrial SSA</h1>

      <p className="text-base leading-relaxed text-neutral-700 dark:text-neutral-300">
        This page exists only to verify the workspace toolchain. No warehouse
        management functionality is implemented: there is no authentication, no
        database schema, no inventory ledger, and no vendor integration wired up
        yet.
      </p>

      <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
        <li>
          Scope, decisions, and delivery phases live in{" "}
          <code className="font-mono">PROJECT_PLAN.md</code>.
        </li>
        <li>
          Next planned vertical slice: PO → Receive → QC → Build pallet/lot →
          Print label → Putaway → Inventory ledger.
        </li>
        <li>Do not deploy this scaffold to a production environment.</li>
      </ul>
    </main>
  );
}
