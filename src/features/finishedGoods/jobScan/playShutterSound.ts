/**
 * A short synthesized shutter click shared by every in-app photo camera.
 *
 * Browsers only allow audio that a user gesture started, while the photo is
 * delivered later from an asynchronous canvas encode. `prime` therefore runs
 * synchronously inside the shutter press and `play` runs once the photo is
 * valid. Audio is best effort: every failure is contained and never affects
 * the capture.
 */
export interface ShutterSound {
  /** Unlock audio during the shutter gesture; plays nothing audible. */
  prime(): void;
  /** One click for one delivered photo. */
  play(): void;
  /** Finish accepted clicks, then release audio; later calls are ignored. */
  dispose(): void;
}

type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | undefined {
  const scope = globalThis as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

const CLICK_SECONDS = 0.08;

function click(audio: AudioContext, onEnded: () => void) {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const start = audio.currentTime;
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(1200, start);
  oscillator.frequency.exponentialRampToValueAtTime(180, start + 0.07);
  gain.gain.setValueAtTime(0.09, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + CLICK_SECONDS);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
    onEnded();
  };
  oscillator.start(start);
  oscillator.stop(start + CLICK_SECONDS);
}

/** Some mobile browsers unlock output only after a sound starts inside the gesture. */
function unlock(audio: AudioContext) {
  const source = audio.createBufferSource();
  source.buffer = audio.createBuffer(1, 1, audio.sampleRate);
  source.connect(audio.destination);
  source.onended = () => source.disconnect();
  source.start();
}

export function createShutterSound(): ShutterSound {
  let context: AudioContext | undefined;
  let unlocked = false;
  let disposed = false;
  let accepted = 0;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function close() {
    clearTimeout(closeTimer);
    const audio = context;
    context = undefined;
    if (!audio) return;
    try {
      void audio.close().catch(() => undefined);
    } catch {
      // Already closed or never usable.
    }
  }

  function finish() {
    accepted--;
    if (disposed && accepted === 0) close();
  }

  const ensure = () => {
    if (disposed) return undefined;
    if (!context) {
      const Context = audioContextConstructor();
      if (!Context) return undefined;
      context = new Context();
    }
    return context;
  };

  return {
    prime() {
      try {
        const audio = ensure();
        if (!audio) return;
        if (audio.state === "suspended")
          void audio.resume().catch(() => undefined);
        if (!unlocked) {
          unlocked = true;
          unlock(audio);
        }
      } catch {
        // Audio is optional; the capture continues.
      }
    },
    play() {
      try {
        const audio = ensure();
        if (!audio) return;
        accepted++;
        const start = () => {
          // A resume that outlives the disposal deadline must stay silent.
          if (context !== audio) return;
          try {
            click(audio, finish);
          } catch {
            finish();
          }
        };
        if (audio.state === "running") start();
        else {
          try {
            void audio.resume().then(start, finish);
          } catch {
            finish();
          }
        }
      } catch {
        // Audio is optional; the photo has already been accepted.
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Location capture immediately unmounts its camera. Let the accepted
      // click finish before closing output, including a pending audio resume.
      if (!accepted) close();
      else closeTimer = setTimeout(close, 500);
    },
  };
}
