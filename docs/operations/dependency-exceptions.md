# Dependency advisory exceptions

The runtime dependency audit (`pnpm audit:prod`, high/critical) accepts **no**
exceptions. An exception covers exactly one advisory, one package, exact
versions and named dependency chains. It needs an owner and an expiry. When an
exception expires, or a new high/critical advisory appears outside it, the
dependency gate must fail. Never use `--ignore-unfixable`, a severity
downgrade or a blanket ignore.

## Current exceptions

None. On 2026-11-09, fresh application and release-tool audits reported zero
high or critical findings; the runtime audit also passed.

The former `braces@3.0.3` exception for
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
was removed after verifying that GitHub withdrew the advisory on 2026-10-23
because it was not practically exploitable. Its dependency-review allow-list
entry was removed too. No exception was renewed.

Reproduce the current evidence:

- `pnpm audit:prod`
- `node scripts/ci/audit-dependencies.mjs --scope=app`
- `node scripts/ci/audit-dependencies.mjs --scope=release`

The maintained HR manual generator has a separate Python dependency scope,
which pnpm does not audit. Its Pillow pin is 13.0.0 (Python 3.11+). Check it with
`uvx --from pip-audit==2.10.1 pip-audit -r docs/manuals/hr-user-guide-th/requirements.txt`.
On 2026-11-09 this reports no known vulnerabilities after replacing the
vulnerable 12.3.0 pin. The [current baseline](../reviews/architecture-current-2026-11-09/tooling-baseline.md)
records the audit and generator compatibility evidence.

### Bundled CLI code

When assessing a future CLI advisory, inspect the published bundle as well as
the lockfile. Dependency overrides do not necessarily replace bundled code.

## Machine-readable gating

The single machine source is `scripts/ci/dependency-exceptions.json`, consumed
by `scripts/ci/audit-dependencies.mjs --scope=app|release`. The scheduled
`Security audit` workflow invokes that gate for each scope; runtime auditing
remains mandatory with no exceptions. The helper checks the exact advisory,
package, version, severity, dependency paths and expiry. An advisory outside an explicitly listed
chain fails; this document does not broaden the machine policy.
With pinned pnpm 10, the npm quick-audit response counts **findings**, not
advisory keys, in each severity total. One advisory can contain several
installed-location findings, including repeated versions on different chains.
The gate reconciles high and critical separately against those finding counts;
it still checks every finding's version and paths before allowing an exception.
See the [current baseline and registry reproduction](../reviews/architecture-current-2026-11-09/tooling-baseline.md).
The PR dependency review is a separate check. Successful enforcement on merged
`main` still requires observing the workflow. See
[implementation status](ci-cd-implementation-status.md) (S10, S12).
