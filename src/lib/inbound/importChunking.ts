/**
 * The import chunk size, restated for the browser.
 *
 * The server owns the rule (`convex/model/inbound/poImport.ts`) and the client
 * cannot import it: `convex/**` is server code, and pulling a Convex-adjacent
 * module into the browser bundle is what `pnpm verify:tenant-boundary` exists to
 * prevent. So the value is restated here, in one place, and an integration drift
 * test asserts the two agree — the same arrangement the ledger's page cap
 * already uses.
 *
 * The client needs it for exactly one reason: preview mode walks the chunk
 * arithmetic locally so the resume path is reviewable without a deployment.
 */
export const DEFAULT_CHUNK_SIZE = 25;
