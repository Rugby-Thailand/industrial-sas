# Dependency advisory exceptions

The runtime dependency audit (`pnpm audit:prod`, high/critical) accepts **no**
exceptions. An exception covers exactly one advisory, one package, exact
versions and named dependency chains. It needs an owner and an expiry. When an
exception expires, or a new high/critical advisory appears outside it, the
dependency gate must fail. Never use `--ignore-unfixable`, a severity
downgrade or a blanket ignore.

## Active exception

| Field                                | Value                                                                                                                                                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Advisory                             | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) / CVE-2026-93687, high, `braces` (regular-expression denial of service in brace expansion)                                                                                               |
| Version                              | `braces@3.0.3` only. The advisory has no patched release.                                                                                                                                                                                                         |
| Application chain (development only) | `.>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces` only. No shadcn or other application chain is excepted.                                                                                                                               |
| Release-tool chain                   | `tools/release`: `.>vercel>@vercel/backends>ts-morph>@ts-morph/common>fast-glob>micromatch>braces` only. No wildcard `@vercel/*` exception is accepted.                                                                                                           |
| Exposure                             | Glob patterns from the repository and trusted CI, parsed by lint and the release CLI on developer/CI machines. `pnpm why braces --prod` shows no production dependency path. The reviewed runtime audit is clean. No runtime application exposure has been shown. |
| Owner                                | CODEOWNERS release/security maintainers (`/.github/`)                                                                                                                                                                                                             |
| Expires                              | **2026-11-09**. Renew only through a reviewed PR with fresh evidence.                                                                                                                                                                                             |
| Removal                              | Remove as soon as a fixed `braces` (or parents that drop it) is available. Then update exact versions/overrides, re-run both audits and delete this entry.                                                                                                        |

Reproduce the evidence locally: `pnpm why braces`, `pnpm why braces --prod`
and `pnpm -C tools/release why braces`.

### Bundled CLI code

The Vercel CLI publishes bundled JavaScript. `tools/release/node_modules/
vercel/dist` contains bundled glob/brace-expansion code (for example
`dist/commands/build/index.js` refers to `braces`). The bundled copy does not
follow lockfile overrides. Once a fix exists, overriding `braces` in
`tools/release` will not show that the CLI's bundled code is fixed. Check the
published CLI release itself, then remove this exception only when both the
lockfile and the bundled code are clean.

## Machine-readable gating

The single machine source is `scripts/ci/dependency-exceptions.json`, consumed
by `scripts/ci/audit-dependencies.mjs --scope=app|release`. The scheduled
`Security audit` workflow invokes that gate for each scope; runtime auditing
remains mandatory with no exceptions. The helper checks the exact advisory,
package, version, severity, dependency paths and expiry. A path outside the two
chains above fails; this document does not broaden the machine policy.
The PR dependency review is a separate check. Successful enforcement on merged
`main` still requires observing the workflow. See
[implementation status](ci-cd-implementation-status.md) (S10, S12).
