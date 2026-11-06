# Optional draft context in discard prompts

A caller may supply a localized plain-string `discardDescription` through `useNavigationDraft`. The existing dialog uses it only for a single dirty registration without a Save action. Missing or whitespace-only descriptions, multiple dirty registrations, and saveable drafts retain the existing generic text. Foreground selection still uses the existing owner selection.

Descriptions are presentation metadata. Updating counts refreshes the accessible description without rearming history or replacing a registration already covered by a discard approval. Dirty/pending state, save and discard callbacks, action order, disabled states, and traversal/completion rules are unchanged. No caller adopts the option in this commit.

## Validation

The four existing guard suites pass 97 cases, including six new cases for live description changes, empty/whitespace fallbacks, multiple/saveable drafts, pending protection, and a description update while an approved discard waits for buffer removal. Navigation fixtures/inventory and normal full ESLint pass. Pinned Bun 1.4.3 typecheck and changed-file formatting pass; exact log hashes are recorded in the accompanying receipt. The initial implementation exposed three stale-description failures; their original log is retained. The first typecheck invocation selected the older global Bun and was rejected before checking code; the retry selects the repository-pinned checker.

Production caller/browser proof remains required after adoption: actual intake/correction counts and updates, Keep/Discard/next Back, pending protection, exact origin, and phone/desktop TH/light EN/dark pixels. Current frozen Stage2 scores and captures do not cover new caller copy.

## Caller wording

Stage2 correction wording approved: EN “Discard the unsaved changes to this job ticket, or keep editing.” TH “เลือกละทิ้งการแก้ไขใบ Job ที่ยังไม่ได้บันทึก หรือแก้ไขต่อ”. Intake may report current registered ticket and selected-photo counts, omitting zero clauses and offering discard or keep. It must not promise a previous uncertain write did not reach the server.
