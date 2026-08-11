/**
 * The single `<h1>` of a screen, with its one-line explanation.
 *
 * Centralised so that every route has exactly one top-level heading and the
 * heading order below it starts at `<h2>`. Skipped levels are one of the most
 * common axe findings and the easiest to reintroduce screen by screen.
 */
export function PageHeader({
  title,
  description,
}: {
  readonly title: string;
  readonly description?: string;
}) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight text-text">{title}</h1>
      {description === undefined ? null : (
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">
          {description}
        </p>
      )}
    </header>
  );
}
