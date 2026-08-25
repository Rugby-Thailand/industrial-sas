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

const sleeper = () => node("setInterval(() => {}, 1000)");

const stubborn = () =>
  node(
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('up')",
  );

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

    await new Promise((resolve) => setImmediate(resolve));

    expect(registry.size()).toBe(0);
  });
});

describe("the shutdown handler", () => {
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
        exits.push({ code, stillRunning: registry.size() });
        order.push("exit");
      },
      addHandler: (signal, handler) => handlers.set(signal, handler),
      graceMs: 200,
    });

    return { handlers, exits, order, registry, shutdown };
  };

  it("stops the children before it exits, not after", async () => {
    const { handlers, exits, registry } = harness();
    const child = registry.track(sleeper());

    handlers.get("SIGINT")?.();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(child.exitCode === null && child.signalCode === null).toBe(false);

    expect(exits).toEqual([{ code: 1, stillRunning: 0 }]);
  });

  it("restores the working tree only once the writers are gone", async () => {
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
