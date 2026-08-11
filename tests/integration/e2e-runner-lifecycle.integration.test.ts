/**
 * Integration tier — the end-to-end runner's process lifecycle, against real
 * processes.
 *
 * `scripts/run-e2e.mjs` starts a production build, a development server, and
 * Playwright. If it can lose track of any of them, a developer's Ctrl-C leaves a
 * `next dev` holding port 3101 and rewriting `next-env.d.ts` — which is the
 * shared-writable-file defect the whole runner exists to prevent, reintroduced
 * through the exit path.
 *
 * Every claim here is made against a spawned Node process rather than against
 * the source text, because the failures are all about *timing*: a listener
 * attached one tick too late, a timer that outlives the thing it was guarding, a
 * handler that exits before its cleanup finishes. None of those are visible in a
 * regular expression over the file.
 *
 * The children are `node -e` one-liners with no side effects. Nothing here
 * signals by name or by port; every process is addressed through the handle the
 * test itself created.
 */
import { spawn, type ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  createChildRegistry,
  installShutdown,
  stopChild,
} from "../../scripts/lib/childLifecycle.mjs";
import { waitForServer } from "../../scripts/lib/serverReadiness.mjs";

/** Everything this file spawned, so a failing assertion cannot leak a process. */
const spawned: ChildProcess[] = [];

const node = (script: string): ChildProcess => {
  const child = spawn(process.execPath, ["-e", script], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  spawned.push(child);
  return child;
};

/** A process that sits there until it is told to go. */
const sleeper = () => node("setInterval(() => {}, 1000)");

/**
 * A process that refuses `SIGTERM`.
 *
 * The one that proves escalation is real. A server wedged mid-compile behaves
 * like this, and a runner that only ever sends `SIGTERM` waits for it forever.
 *
 * It announces itself on stdout, and callers wait for that. Signalling a Node
 * process before it has finished booting kills it by default disposition — the
 * handler is not installed yet — which would make this fixture prove nothing.
 */
const stubborn = () =>
  node(
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('up')",
  );

/** Resolve once the child has printed anything, so its handlers are installed. */
const started = (child: ChildProcess): Promise<ChildProcess> =>
  new Promise((resolve) => {
    child.stdout?.once("data", () => resolve(child));
  });

const closed = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("close", () => resolve());
  });

afterEach(async () => {
  for (const child of spawned.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
});

describe("stopChild", () => {
  it("stops a running child and resolves only once it is gone", async () => {
    const child = sleeper();

    await stopChild(child);

    expect(child.exitCode === null && child.signalCode === null).toBe(false);
  });

  it("resolves at once for a child that already exited", async () => {
    const child = node("");
    await closed(child);

    await expect(stopChild(child)).resolves.toBeUndefined();
  });

  it("resolves at once for a child a signal already killed", async () => {
    /*
     * The case a naive guard misses. A child killed by a signal has a **null**
     * `exitCode` and a set `signalCode`, so `if (child.exitCode !== null)` reads
     * it as still running: the stop signals a reaped pid and then waits for a
     * `close` that fired long ago, resolving only when the grace period expires.
     *
     * The grace here is thirty seconds and the assertion is under one, so a
     * regression cannot pass by being merely slow.
     */
    const child = sleeper();
    child.kill("SIGKILL");
    await closed(child);
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBe("SIGKILL");

    const started = performance.now();
    await stopChild(child, { graceMs: 30_000 });

    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const child = await started(stubborn());

    await stopChild(child, { graceMs: 200 });

    expect(child.signalCode).toBe("SIGKILL");
  });

  it("is safe to call twice", async () => {
    const child = sleeper();

    await stopChild(child);
    await expect(stopChild(child)).resolves.toBeUndefined();
  });

  it("leaves no timer holding the event loop open", async () => {
    /*
     * The escalation timer must be cleared when the child goes quietly, and
     * unreferenced while it waits. An uncleared ten-second timer is why a runner
     * that has finished sits there doing nothing before the shell returns.
     */
    const before = process.getActiveResourcesInfo().filter(isTimeout).length;
    const child = sleeper();

    await stopChild(child, { graceMs: 30_000 });

    expect(
      process.getActiveResourcesInfo().filter(isTimeout).length,
    ).toBeLessThanOrEqual(before);
  });
});

const isTimeout = (resource: string) => resource === "Timeout";

describe("the child registry", () => {
  it("stops every child it was given, including a stubborn one", async () => {
    const registry = createChildRegistry();
    const quiet = registry.track(sleeper());
    const wedged = registry.track(await started(stubborn()));

    await registry.stopAll({ graceMs: 200 });

    expect(quiet.exitCode === null && quiet.signalCode === null).toBe(false);
    expect(wedged.signalCode).toBe("SIGKILL");
  });

  it("forgets a child that exits on its own, so nothing stale is signalled", async () => {
    const registry = createChildRegistry();
    const child = registry.track(node(""));

    await closed(child);
    // The `close` listener runs on the same event, so give it its turn.
    await new Promise((resolve) => setImmediate(resolve));

    expect(registry.size()).toBe(0);
  });
});

describe("the shutdown handler", () => {
  /** Capture the handlers rather than installing them on this test process. */
  const harness = () => {
    const handlers = new Map<string, () => void>();
    const exits: { code: number; stillRunning: number }[] = [];
    const order: string[] = [];
    const registry = createChildRegistry();

    const shutdown = installShutdown({
      registry,
      onCleanup: () => {
        order.push("cleanup");
      },
      exit: (code) => {
        // What was still running *at the moment of exit* is the whole question.
        exits.push({ code, stillRunning: registry.size() });
        order.push("exit");
      },
      addHandler: (signal, handler) => handlers.set(signal, handler),
      graceMs: 200,
    });

    return { handlers, exits, order, registry, shutdown };
  };

  it("stops the children before it exits, not after", async () => {
    /*
     * The defect this replaces: `process.on("SIGINT", () => process.exit(1))`.
     * That ends the event loop immediately, so no `finally` runs, the
     * development server survives its parent, and the port stays held.
     */
    const { handlers, exits, registry } = harness();
    const child = registry.track(sleeper());

    handlers.get("SIGINT")?.();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(child.exitCode === null && child.signalCode === null).toBe(false);
    // Nothing of ours was still running when the exit was taken. A handler that
    // exited first would leave the count above zero — and, in the real runner,
    // a development server holding port 3101.
    expect(exits).toEqual([{ code: 1, stillRunning: 0 }]);
  });

  it("restores the working tree only once the writers are gone", async () => {
    // A development server that is still alive rewrites `next-env.d.ts`, so a
    // cleanup that ran first would restore the file to the wrong thing.
    const { handlers, order, registry } = harness();
    registry.track(sleeper());

    handlers.get("SIGTERM")?.();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(order).toEqual(["cleanup", "exit"]);
  });

  it("exits non-zero, because an interrupted run did not pass", async () => {
    const { handlers, exits } = harness();

    handlers.get("SIGINT")?.();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(exits.map((call) => call.code)).toEqual([1]);
  });

  it("runs one teardown however many times it is asked", async () => {
    /*
     * A second Ctrl-C while a server is shutting down must not start a second
     * teardown, and must not skip the first one's restore.
     */
    const { handlers, order, registry } = harness();
    registry.track(await started(stubborn()));

    handlers.get("SIGINT")?.();
    handlers.get("SIGINT")?.();
    handlers.get("SIGTERM")?.();
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(order.filter((step) => step === "cleanup")).toEqual(["cleanup"]);
  });

  it("is the same teardown the clean path calls", async () => {
    // The returned function is what `run-e2e.mjs` awaits in its `finally`, so
    // the interrupted path and the successful one cannot drift apart.
    const { shutdown, order, registry } = harness();
    registry.track(sleeper());

    await shutdown();

    expect(order).toEqual(["cleanup"]);
    expect(registry.size()).toBe(0);
  });
});

describe("waiting for the preview server", () => {
  /**
   * The silent failure this replaces.
   *
   * A readiness loop that ran out of attempts and simply fell through left the
   * warm-up talking to a port nobody was on: every request failed to connect,
   * no route compiled, and Playwright then reported 123 broken specs instead of
   * the one fact that mattered — the server never listened.
   */
  it("throws when the server never accepts a request", async () => {
    let probes = 0;

    await expect(
      waitForServer({
        probe: () => {
          probes += 1;
          return Promise.reject(new Error("ECONNREFUSED"));
        },
        attempts: 3,
        delayMs: 1,
        describe: "the preview server",
      }),
    ).rejects.toThrow(/did not accept a request/);

    expect(probes).toBe(3);
  });

  it("names the process, not the timeout, when it died during boot", async () => {
    // A server that crashed on startup is a different fix from a slow one, and
    // waiting out the full timeout to say so wastes two minutes of somebody's
    // attention.
    await expect(
      waitForServer({
        probe: () => Promise.reject(new Error("ECONNREFUSED")),
        isAlive: () => false,
        attempts: 120,
        delayMs: 1_000,
        describe: "the preview server",
      }),
    ).rejects.toThrow(/exited before it listened/);
  });

  it("returns as soon as the server answers", async () => {
    let probes = 0;

    const attempts = await waitForServer({
      probe: () => {
        probes += 1;
        return probes < 3
          ? Promise.reject(new Error("ECONNREFUSED"))
          : Promise.resolve();
      },
      attempts: 10,
      delayMs: 1,
    });

    expect(attempts).toBe(3);
  });
});
