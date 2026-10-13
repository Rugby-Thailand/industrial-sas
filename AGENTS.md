<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Back and navigation changes

Read [the Back navigation contract](docs/contracts/back-navigation.md) and its [reviewed inventory](docs/contracts/back-navigation.json) before adding or changing routes, foreground views, editor closure, or task completion.

Back dismisses the foreground or restores the earlier workflow before leaving its page. Use a named `useWorkflowStep` with a real `enter()`/event or `active` connection, shared Back-aware Dialog/Sheet, and an explicit safe header parent or audited hub. Cancel and completion must consume their owned entries; successful asynchronous writes use the live operation completion owner. Preserve the actual origin's locale, query, and hash, retained drafts, and pending-write protection.

Declare each new route, render-controlling state, and navigation action in the inventory. Presentation decisions record exact semantic component/role targets and need another audit when those targets change. Use existing literal regression case titles from the actual changed callers; shared infrastructure evidence supplements caller coverage. Do not add directory exemptions, label a whole-view editor/camera as presentation, invent evidence, or regenerate policies blindly to satisfy CI.

Run `pnpm check:navigation` and normal ESLint after navigation changes. The gate reads production source as data and checks every page/error route; `pnpm test:navigation` runs its explicit Node fixtures. For runtime changes, run the relevant caller tests covering header/native Back, explicit Close/Cancel followed by the next Back, direct links, locale/query/hash, dirty/pending drafts, nested foregrounds, completion, Forward, and refresh/remount. Static checks do not replace those runtime cases.
