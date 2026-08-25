export const DEFAULT_GRACE_MS = 5_000;

const hasExited = (child) =>
  child.exitCode !== null || child.signalCode !== null;

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

    child.once("close", finish);

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

export function createChildRegistry() {
  const children = new Set();

  return {
    track(child) {
      children.add(child);
      child.once("close", () => children.delete(child));
      return child;
    },

    size: () => children.size,

    async stopAll(options) {
      await Promise.all(
        [...children].map((child) => stopChild(child, options)),
      );
    },
  };
}

/**
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
