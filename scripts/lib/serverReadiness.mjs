/**
 * Waiting for a server to listen, and admitting when it never did.
 *
 * Its own module because the failure it guards is a *silent* one. A readiness
 * loop that simply runs out of attempts and falls through leaves the caller
 * talking to a port nobody is on: every subsequent request fails to connect,
 * every route stays uncompiled, and the suite reports a hundred broken specs
 * instead of the one true fact — the server never started. The loop that gives
 * up has to say so.
 */

/**
 * Poll `probe` until it succeeds, or throw.
 *
 * `isAlive` is checked each round so a process that died during boot is reported
 * as what it is, immediately, rather than after the full timeout. `describe`
 * names the thing being waited for, because "timed out" on its own sends the
 * reader to the wrong place.
 */
export async function waitForServer({
  probe,
  isAlive = () => true,
  attempts = 120,
  delayMs = 1_000,
  describe: what = "the server",
}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!isAlive()) {
      throw new Error(`${what} exited before it listened`);
    }
    try {
      await probe();
      return attempt + 1;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `${what} did not accept a request within ${attempts} attempt(s)`,
  );
}
