# Development refresh / recording investigation

2026-09-06 local date; timestamps below are UTC on 2026-09-05.

## Report and observed cause

During a live development-page refresh at approximately 17:33:21, Chrome reported `SyntaxError: Invalid or unexpected token` for the locale layout chunk, and the server-rendered shell remained unhydrated. A subsequent ordinary reload succeeded with the stored record intact.

The saved response `.cache/qa-layout-chunk.js` and an independent fresh HTTP GET were byte-identical: SHA-1 `4e6c5a4189b322b7710e6874315cb8bcbd8d8212`, length 4,686,006 bytes. The outer JavaScript parsed, and all **248 eval-wrapped source modules** also parsed with Node's `vm.Script`. The response had JavaScript content type, a matching content length, and `no-cache, must-revalidate`. No matching syntax/ChunkLoadError was recorded in the Next development log.

The Next development trace exposed a concrete separate fault: each recording frame written inside the repository invalidated the client build. Between 17:33:00 and 17:33:30 there were **25 client invalidations: 23 recording artifact writes and 2 documentation writes**. Around the failure, frames 000156, 000157, 000160, 000162, 000163, and 000164 each caused a fresh compilation and chunk emission, typically 170–470 ms apart.

The dev server used `.next/dev` on port 3100. The production preview used `.next-build` on port 3210, with its own build identity. No evidence of production output overwriting the dev output was found.

The recording-triggered rebuild storm is established by trace evidence. It is a plausible contributor to the transient refresh failure, but the precise malformed browser response was not captured, so the SyntaxError's exact parsing cause is not proven.

## Fix

`next.config.ts` now adds dev-only Webpack watch exclusions for this worktree's `artifacts/`, `.cache/`, and `docs/plans/` directories. The existing Next watch settings and ignore regex are preserved, including `node_modules`, `.git`, and `.next`. Production configuration is unchanged. Source, messages, and backend files remain watchable; similarly named nonexcluded paths are not accidentally matched.

The main task moved active capture outside the worktree as an additional operational measure. The new ignore rule also permits copying finished evidence into the repository without repeatedly re-emitting client chunks.

Next automatically restarted after the configuration change, around 17:38 UTC. No server was killed and authentication configuration was unchanged.

## Verification

- `pnpm typecheck`: passed.
- `pnpm exec eslint next.config.ts --max-warnings=0`: passed.
- Config formatting and whitespace checks: passed.
- Loaded the actual config through Next's config loader, preserving the next-intl wrapper, then ran the bundled Watchpack against the resulting watch options.
- Wrote simultaneous temporary probes under `artifacts/`, `.cache/`, `docs/plans/`, and `src/`. Watchpack observed the source probe and none of the three excluded probes. All probes were removed.
- The live Next trace independently recorded the source-probe add/remove invalidations and no excluded-probe invalidations.
- Checked that existing dependency/build-directory exclusions still match, and runtime source paths do not. Temporary probe filenames were `.qa-watch-probe.txt`.

The main task performs the repeated browser refresh checks and final walkthrough. This report does not claim that the one transient parser error was independently reproduced or that a source-module syntax bug was fixed.
