# External TypeScript 6 build gate proof

Integration changes are scoped to Next config and tests. Exact `CI_EXTERNAL_TYPECHECK=1` allows Next to skip its built-in TypeScript compiler. Unset/default and other values keep the check. The flag is an opt-in, not proof of successful validation: parent workflow must require the exact-SHA TypeScript 6 lane, and only trusted gated remote build command may set it. Ordinary local `pnpm build` remains checked.

Primary installed docs: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/typescript.md` explicitly says ignoreBuildErrors bypasses compilation completely, requiring a separate build/deploy type check. Installed Next 16.3.8 source `dist/lib/typescript/runTypeCheck.js` parses the same tsconfig and merges required defaults with project options, forcing declarationMap=false, emitDeclarationOnly=false, noEmit=true. Repository parsed options exactly match Next's required module, resolution, JSX, interop, isolatedModules and JSON defaults; no declaration-only options enabled. Both skipLibCheck=true.

Next filters `.next/dev/types` out of build roots and filters spec/test diagnostics. External `next typegen && tsc --noEmit` regenerates route types, uses the same pinned TypeScript 6.0.3/tsconfig, and checks a broader scope including tests and any present dev types. Fresh CI checkout avoids stale generated files. Config includes `.next/types/**/*.ts` and excludes neither `.next` nor app source. `next typegen` runs TypeScript setup/config generation before emitting validators; it does not itself run the compiler. Thus the full external command is mandatory, not only typegen or Bun's checker.

Tests use Next's actual production config loader to prove flag semantics. A real pinned tsc subprocess rejects deliberately invalid application source and separately invalid `.next/types/validator.ts`; correcting both succeeds. A scope test compares parsed repository options against installed Next `getRequiredConfiguration`, checks actual source/test inclusion, route-type includes and compiler pin.

Validation:

```sh
pnpm exec vitest run tests/integration/bun-checker.integration.test.ts --maxWorkers=1
pnpm exec vitest run tests/integration/external-typecheck.integration.test.ts --maxWorkers=1
pnpm exec eslint next.config.ts tests/integration/external-typecheck.integration.test.ts tests/integration/bun-checker.integration.test.ts --max-warnings=0
pnpm exec prettier --check next.config.ts tests/integration/external-typecheck.integration.test.ts tests/integration/bun-checker.integration.test.ts
```

14 existing Bun checker tests passed in3.13s;3 new external-typecheck tests passed in7.81s, including subprocess compiler/config startup. Initial concurrent two-file run hit an unrelated existing Bun fake-PATH case's5s timeout while other workloads ran; sequential rerun passed unchanged. New subprocess-heavy cases have explicit20s limits to tolerate shared-runner contention. No full production build repeated for this proof. Parent/quality owner runs complete real repository TS6 validation and required-gate regression tests.

Expected improvement is removing redundant post-compile remote TS6 checking from the serialized deployment path. Previously measured warm remote Next TypeScript phase45.657s; this is a timing hypothesis until the modified remote candidate actually reports skipping type validation and quality TS6 still fails deliberate defects. No type-error waiver or unconditional local skip is introduced.
