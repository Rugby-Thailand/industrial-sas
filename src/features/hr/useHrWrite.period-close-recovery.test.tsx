import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useHrWrite } from "./useHrWrite";

// Only the surrounding provider identity is substituted. Command ownership,
// serialization, restored state and operation resolution are production code.
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    identityKey: "period-org:period-actor:period-employee",
  }),
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

it("restores begin, publish and cancel as recoverable commands after a reload", async () => {
  const cases = [
    // Exact useHrWrite intents and mutation operations in PeriodDetailScreen.
    ["period:close:period-probe:1", "hr.period.beginClose"],
    ["period:publish:period-probe:version-probe", "hr.period.closeVersion"],
    ["period:cancel:period-probe:version-probe", "hr.period.cancelClose"],
  ] as const;
  const saved: {
    intent: string;
    actual: string | undefined;
    expected: string;
    unavailable: boolean;
  }[] = [];
  for (const [intent, expected] of cases) {
    const hook = renderHook(() => useHrWrite(intent));
    let finish!: (result: unknown) => void;
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.current.submit(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    });
    const key = `hr-request:period-org:period-actor:period-employee|${intent}`;
    const serialized = sessionStorage.getItem(key)!;
    const record = JSON.parse(serialized);
    expect(record.requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    // A normal fulfilled mutation settles the promise. There is no simulated
    // lost post-commit response, rejection, or altered Convex retry behavior.
    await act(async () => {
      finish({ ok: true, value: { written: true } });
      await pending;
    });
    hook.unmount();
    // A hard reload while the command was pending retains exactly these
    // serialized bytes but loses the in-memory callback. Restore that state;
    // no network exception is synthesized and no server guard is replaced.
    sessionStorage.setItem(key, serialized);
    const restored = renderHook(() => useHrWrite(intent));
    expect(restored.result.current.locked).toBe(true);
    const state = restored.result.current.state;
    expect(state.kind).toBe("UNCERTAIN");
    if (state.kind === "UNCERTAIN")
      saved.push({
        intent,
        actual: state.recovery?.operation,
        expected,
        unavailable: state.recoveryUnavailable === true,
      });
    expect(state.kind === "UNCERTAIN" && state.recoveryUnavailable).not.toBe(
      true,
    );
    restored.unmount();
    sessionStorage.removeItem(key);
  }
  const correctOperations = saved.filter(
    (record) => record.actual === record.expected,
  ).length;
  expect(correctOperations, JSON.stringify(saved)).toBe(3);
});
