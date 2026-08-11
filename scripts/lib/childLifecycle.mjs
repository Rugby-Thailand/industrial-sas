/**
 * Owning the processes a script starts, and letting go of them exactly once.
 *
 * Extracted from `scripts/run-e2e.mjs` so it can be tested against real
 * processes rather than asserted about by reading source. Everything here is
 * about one question: when this script stops — cleanly, by exception, or because
 * somebody pressed Ctrl-C — does every process it started stop too, and does it
 * stop *only* those?
 *
 * ### Only by handle
 *
 * Nothing is matched by name, port, or command line. A `pkill next` on a
 * developer's machine kills whatever else they were running, and a port-based
 * search kills whoever happens to hold the port — which may be the very server
 * this script refuses to adopt. Every signal here goes to a `ChildProcess` this
 * module was handed, so it can only ever reach a descendant of this script.
 *
 * ### The three ways a naive version leaks
 *
 * 1. **A signal handler that exits immediately.** `process.on("SIGINT", () =>
 *    process.exit(1))` terminates the event loop before any `finally` runs, so
 *    the servers the script started outlive it and keep holding their ports.
 *    Cleanup has to be awaited *before* the exit.
 * 2. **A signal that is not forwarded.** A signal sent to this process alone —
 *    `kill -INT <pid>`, or a supervisor stopping a job — does not reach a child.
 *    Only a terminal delivers to the whole foreground group, and relying on that
 *    means the programmatic case leaks.
 * 3. **A `close` listener attached after the child already closed.** `close` is
 *    emitted once. Attaching a listener afterwards waits forever, and the
 *    "graceful stop" hangs until whatever timeout the caller happened to add.
 *    So the state is re-read *after* attaching, which closes the window.
 */

/** Milliseconds a child gets to exit on its own before it is killed outright. */
export const DEFAULT_GRACE_MS = 5_000;

/** True once the process has exited, however it exited. */
const hasExited = (child) =>
  child.exitCode !== null || child.signalCode !== null;

/**
 * Stop one child and resolve when it is genuinely gone.
 *
 * Escalates rather than hoping: the requested signal first, then `SIGKILL` after
 * `graceMs`. The timer is cleared on the way out and unreferenced while it
 * waits, so a stopped child can never hold the event loop open — a stray
 * `setTimeout` is why a runner that "finished" sits there for ten seconds.
 *
 * Safe to call twice; the second call sees an exited child and resolves at once.
 */
export function stopChild(
  child,
  { signal = "SIGTERM", graceMs = DEFAULT_GRACE_MS } = {},
) {
  return new Promise((resolve) => {
    let killTimer;

    const finish = () => {
      clearTimeout(killTimer);
      child.off("close", finish);
      resolve();
    };

    // Attached before anything is decided. `close` is emitted once, and a
    // listener added after the fact waits for an event that has already
    // happened — which is a hang, not a slow stop.
    child.once("close", finish);

    /*
     * Both fields, and this is the one that bit: a child killed by a signal has
     * a **null** `exitCode` and a set `signalCode`. A guard that read only
     * `exitCode` treated an already-dead process as running, signalled a reaped
     * pid, and then waited out its entire grace period for a `close` that had
     * already fired.
     */
    if (hasExited(child)) {
      finish();
      return;
    }

    try {
      child.kill(signal);
    } catch {
      // Reaped between the check and the call. `close` still arrives.
    }

    killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Gone in the meantime; `close` resolves us.
      }
    }, graceMs);
    killTimer.unref();
  });
}

/**
 * A registry of the processes one script owns.
 *
 * A child is added when it is spawned and removed when it closes, so `stopAll`
 * only ever signals something still running, and the set does not grow across a
 * long run.
 */
export function createChildRegistry() {
  const children = new Set();

  return {
    /** Track a spawned child and hand it straight back. */
    track(child) {
      children.add(child);
      child.once("close", () => children.delete(child));
      return child;
    },

    /** How many are still running. Exposed so a test can assert the set drains. */
    size: () => children.size,

    /** Stop everything still running, concurrently, and wait for all of it. */
    async stopAll(options) {
      await Promise.all(
        [...children].map((child) => stopChild(child, options)),
      );
    },
  };
}

/**
 * Install signal handlers that clean up *first* and exit afterwards.
 *
 * The returned function is also the one to call from a `finally`, so the clean
 * path and the interrupted path share an implementation rather than two that
 * drift. It runs at most once: a second Ctrl-C while a server is shutting down
 * must not start a second teardown, and must not skip the first one's restore.
 *
 * `onCleanup` is where the caller puts anything that is not a process — for this
 * runner, restoring `next-env.d.ts`. It runs after the children are gone,
 * because a development server that is still alive will write the file again.
 *
 * `exit` and `addHandler` are injected so a test can observe the decisions
 * without terminating the test runner or installing handlers on it. They are
 * typed here rather than inferred: `process.exit` returns `never`, and a default
 * inferred from it would force every caller's stub to be non-returning too.
 *
 * @param {{
 *   registry: { stopAll: (options?: object) => Promise<void> },
 *   onCleanup?: () => void | Promise<void>,
 *   exit?: (code: number) => void,
 *   signals?: readonly string[],
 *   addHandler?: (signal: string, handler: () => void) => void,
 *   graceMs?: number,
 * }} options
 * @returns {(signal?: string) => Promise<void>}
 */
export function installShutdown({
  registry,
  onCleanup = () => {},
  exit = (code) => {
    process.exit(code);
  },
  signals = ["SIGINT", "SIGTERM"],
  addHandler = (signal, handler) => {
    process.on(signal, handler);
  },
  graceMs = DEFAULT_GRACE_MS,
}) {
  let running;

  const shutdown = async (signal) => {
    if (running !== undefined) return running;
    running = (async () => {
      // Forwarded, not assumed: a signal sent to this process alone never
      // reaches a child, and a terminal's group delivery is the lucky case.
      await registry.stopAll({
        ...(signal === undefined ? {} : { signal }),
        graceMs,
      });
      await onCleanup();
    })();
    return running;
  };

  for (const signal of signals) {
    addHandler(signal, () => {
      void shutdown(signal).then(
        () => exit(1),
        () => exit(1),
      );
    });
  }

  return shutdown;
}
