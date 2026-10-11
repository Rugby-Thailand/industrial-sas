# Non-AI barcode image scanning

Implement in the isolated `fix/non-ai-barcode-images` worktree from `b232565`.

Add image acquisition to the real shared scanner, location picker, JOB ticket intake, and ticket field scanners. Decode locally in a cancellable worker with bounded crop, angle, and curve correction. Serve the pinned WASM from this application, without AI calls, third-party runtime downloads, or uploads. Keep backend identity resolution, permissions, existing replacement confirmations, and save behavior.

Regression coverage must exercise the actual worker on the supplied private photo corpus, exact identities, curved-read confirmation, negative controls, cancellation, and UI acquisition/validation. Do not commit real customer photographs: the existing fixture rules require synthetic data. Add reproducible synthetic cases and a local private-corpus runner.

Audit source/session lifecycle and requirements against the pinned base after implementation. Run focused tests, formatting, lint, type checking, production build, real-browser checks, and the private corpus repeatedly when failures justify it. Open and link a PR after resolving audit findings. Physical-device camera performance must be reported separately from browser/fixture validation.

Integration update: merge current main (`41c73ff`) into the isolated branch and preserve location registration, exact location lookup, storage-format selection, camera framing, and the explicit AI location workflow. Non-AI image acquisition remains local and requires acceptance; AI handoff is a separate explicit action. Retain manual crop and retry. Run the established location decoder geometry inside the owned worker alongside WASM, preserving ambiguous QR/Code128 choices. Recheck both incoming location/AI browser suites and the compiled Next.js worker before finishing the merge and updating the PR.
