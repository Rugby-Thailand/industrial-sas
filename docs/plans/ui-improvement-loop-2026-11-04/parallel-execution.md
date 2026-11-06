# Parallel UI execution

Owner authorization, 2026-11-06: use sub-agents concurrently; merge when tests and quality gates pass. Only Codex and Kiro CLI. Approved scope remains Stages 1–4. No direct Claude provider agents.

## Ownership

- Stage 2: `finished-goods/scan/**`, `finished-goods/packages/scan/**`, `jobScan/**`, `PackageScanScreen`, barcode camera/image/crop presentation, `CameraFrame`, their tests and Stage 2 evidence.
- Stage 3: other finished-goods routes and catalogue, product, packing, batch, pallet, move, stack and destination-picker/scanner presentation, tests and Stage 3 evidence.
- Stage 4: storage-layout routes except demo, storageLayouts feature/component presentation, tests and Stage 4 evidence.
- Coordinator: shell, shared UI primitives, tokens, `finishedGoods/shared.tsx`, `features/storageKit/**`, navigation infrastructure, harness, seeds, dependencies, frozen rubric, benchmark and decisions.
- Translations: key-scoped edits only. Stage 2 owns JobScan and its package-scan keys; Stage 3 owns remaining FinishedGoods; Stage 4 owns StorageLayouts. Report cross-namespace changes for integration.
- Navigation inventory: each agent reviews and supplies exact changed entries and real caller regression titles; coordinator combines them. Never regenerate policies or add blanket exceptions.

Stage 2 camera components are consumed by Stage 3 DestinationScanner. Preserve component contracts; coordinate necessary shared changes and rerun cross-stage scanner tests after integration. Preserve backend data rules, validation, barcode recognition and scan routing. Preserve existing labeled controls while the historical scan-button-label product decision remains unsettled; it is not a blanket block on Stage 2 work.

## Verification and resources

Use isolated T3-prepared worktrees. Concurrent source editing and focused tests are allowed; use one test worker. Serialize production builds, full `pnpm check`, full accessibility suites, browser captures and model audit batches through a shared coordinator-owned machine lock. Do not run the existing `serve-loop.sh`: it uses a fixed port, global process killing and tsconfig checkout. Start servers on distinct ports and stop only owned PIDs; preserve tsconfig explicitly around production builds.

Use one coordinator-owned local Convex backend only during serialized fixture/capture windows. Never independently reseed it. Stage 2 save/delete captures mutate fixture data and need ordered cleanup. Never display credentials or Clerk sign-in-ticket URLs. Do not stop another task's processes.

Stage 2 has an incomplete 16/19 probe capture, not a scored baseline. Stages 3 and 4 need complete screen/state manifests. Capture populated, empty, loading/error and relevant foreground states, then audit unchanged-source baselines. Existing harness captures an admin persona only; do not claim warehouse-worker permission evidence. Fake camera footage does not establish field or physical-device usability.

Apply the existing blind Sol and Kiro Opus rubric without weakening it. All screens must reach at least 9 from both models on the same source. Inspect capture errors, console errors, overflow and serious/critical axe results explicitly. Record runtime navigation evidence and annotated before/after images at the existing checkpoints. Keep model claims distinct from physical-device coverage.

## Merge

Each stage supplies source commits, audit provenance, tests, runtime evidence and a reviewable PR. Before merging, integrate current main, resolve concrete reviews, run appropriate integrated gates and verify required GitHub checks. Never bypass protections or substitute old audit scores for changed UI. Merge serially so later stages validate against earlier merged work. The owner has already approved these merges; no further permission request is required when the gates pass.
