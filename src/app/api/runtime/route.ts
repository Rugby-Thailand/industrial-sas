// Public runtime probe for the credential-free and release smoke checks: which
// JavaScript runtime serves this request. It returns only the runtime name and
// version plus a sanitized public commit SHA, never other environment data.

// Evaluated per request: a build-time prerender would report the build runtime.
export const dynamic = "force-dynamic";

const RELEASE_SHA = /^[0-9a-f]{40}$/;

export function GET(): Response {
  const bun = process.versions.bun;
  const releaseSha = process.env.RELEASE_SHA ?? "";
  return Response.json(
    {
      runtime: bun === undefined ? "node" : "bun",
      name: process.release.name,
      version: bun ?? process.versions.node,
      releaseSha:
        releaseSha.length === 40 && RELEASE_SHA.test(releaseSha)
          ? releaseSha
          : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
