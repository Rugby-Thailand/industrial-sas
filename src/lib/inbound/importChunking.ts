/**
 * The import chunk size, restated for the browser.
 *
 * The server owns the rule (`convex/model/inbound/poImport.ts`) and the client
 * cannot import it: `convex/**` is server code, and pulling a Convex-adjacent
 * module into the browser bundle is what `pnpm verify:tenant-boundary` exists to
 * prevent. So the value is restated here, in one place, and an integration drift
 * test asserts the two agree — the same arrangement the ledger's page cap
 * already uses.
 */
export const DEFAULT_CHUNK_SIZE = 25;
