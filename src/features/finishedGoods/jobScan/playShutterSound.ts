/** A short local click, started by the shutter gesture; audio never blocks capture. */
export function playShutterSound() {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const audio = context;
    void audio
      .resume()
      .then(() => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(1200, audio.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(
          180,
          audio.currentTime + 0.07,
        );
        gain.gain.setValueAtTime(0.035, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.08);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.onended = () => {
          void audio.close().catch(() => {});
        };
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.08);
      })
      .catch(() => {
        void audio.close().catch(() => {});
      });
  } catch {
    if (context) void context.close().catch(() => {});
  }
}
