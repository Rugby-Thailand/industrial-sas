import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createShutterSound } from "./playShutterSound";

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  onended: (() => void) | null = null;
  buffer: unknown = null;
  type = "";
  frequency = {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  gain = {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

const audio = vi.hoisted(() => ({
  contexts: [] as unknown[],
  oscillators: [] as unknown[],
  resume: vi.fn(),
}));

class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 1;
  sampleRate = 44_100;
  destination = {};
  close = vi.fn(() => Promise.resolve());
  resume = vi.fn(() => {
    audio.resume();
    this.state = "running";
    return Promise.resolve();
  });
  constructor() {
    audio.contexts.push(this);
  }
  createBuffer = vi.fn(() => ({}));
  createBufferSource = vi.fn(() => new FakeNode());
  createGain = vi.fn(() => new FakeNode());
  createOscillator = vi.fn(() => {
    const node = new FakeNode();
    audio.oscillators.push(node);
    return node;
  });
}

beforeEach(() => {
  audio.contexts = [];
  audio.oscillators = [];
  audio.resume.mockReset();
  vi.stubGlobal("AudioContext", FakeAudioContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("resumes audio inside the gesture and plays one click per delivered photo on one context", async () => {
  const sound = createShutterSound();
  sound.prime();
  expect(audio.resume).toHaveBeenCalledOnce();
  expect(audio.oscillators).toHaveLength(0);
  await Promise.resolve();
  sound.play();
  sound.prime();
  sound.play();
  expect(audio.contexts).toHaveLength(1);
  expect(audio.oscillators).toHaveLength(2);
  const [click] = audio.oscillators as FakeNode[];
  expect(click!.start).toHaveBeenCalledOnce();
  expect(click!.stop).toHaveBeenCalledOnce();
  click!.onended?.();
  expect(click!.disconnect).toHaveBeenCalledOnce();
});

it("lets an accepted click finish when capture immediately unmounts the camera", async () => {
  const sound = createShutterSound();
  sound.play();
  expect(audio.oscillators).toHaveLength(0);
  await Promise.resolve();
  expect(audio.oscillators).toHaveLength(1);
  sound.dispose();
  const [context] = audio.contexts as FakeAudioContext[];
  expect(context!.close).not.toHaveBeenCalled();
  (audio.oscillators[0] as FakeNode).onended?.();
  expect(context!.close).toHaveBeenCalledOnce();
  sound.prime();
  sound.play();
  expect(audio.contexts).toHaveLength(1);
  expect(audio.oscillators).toHaveLength(1);
});

it("never throws when audio is unavailable, blocked or rejected", async () => {
  vi.stubGlobal("AudioContext", undefined);
  const missing = createShutterSound();
  expect(() => {
    missing.prime();
    missing.play();
    missing.dispose();
  }).not.toThrow();

  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        throw new DOMException("Blocked", "NotAllowedError");
      }
    },
  );
  const blocked = createShutterSound();
  expect(() => {
    blocked.prime();
    blocked.play();
  }).not.toThrow();

  vi.stubGlobal(
    "AudioContext",
    class extends FakeAudioContext {
      override resume = vi.fn(() =>
        Promise.reject(new DOMException("Denied", "NotAllowedError")),
      );
    },
  );
  const denied = createShutterSound();
  expect(() => {
    denied.prime();
    denied.play();
  }).not.toThrow();
  await Promise.resolve();
  expect(audio.oscillators).toHaveLength(0);
});

it("finishes a queued successful capture even if its camera unmounts while audio resumes", async () => {
  const sound = createShutterSound();
  sound.play();
  sound.dispose();
  const [context] = audio.contexts as FakeAudioContext[];
  expect(context!.close).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(audio.oscillators).toHaveLength(1);
  (audio.oscillators[0] as FakeNode).onended?.();
  expect(context!.close).toHaveBeenCalledOnce();
});

it("releases output if resume never settles and suppresses a late click", async () => {
  vi.useFakeTimers();
  let resume!: () => void;
  vi.stubGlobal(
    "AudioContext",
    class extends FakeAudioContext {
      override resume = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resume = resolve;
          }),
      );
    },
  );
  const sound = createShutterSound();
  sound.play();
  sound.dispose();
  vi.advanceTimersByTime(500);
  const [context] = audio.contexts as FakeAudioContext[];
  expect(context!.close).toHaveBeenCalledOnce();
  resume();
  await Promise.resolve();
  expect(audio.oscillators).toHaveLength(0);
});
