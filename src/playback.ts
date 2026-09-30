export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'ended';

export interface Playback {
  play(): void;
  pause(): void;
  seek(index: number): void;
  step(delta: number): void;
  stop(): void;
  setIntervalMs(ms: number): void;
  state(): { index: number; status: PlaybackStatus };
}

/** Steps through `length` frames on a timer; at most one timer is ever pending. */
export function createPlayback(o: {
  length: number;
  intervalMs: number;
  onFrame(i: number): void;
  onEnd(): void;
}): Playback {
  let index = -1;
  let status: PlaybackStatus = 'idle';
  let interval = o.intervalMs;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  const show = (i: number) => { index = i; o.onFrame(i); };
  const schedule = () => { clear(); timer = setTimeout(tick, interval); };
  const clamp = (i: number) => Math.max(0, Math.min(o.length - 1, i));

  function tick() {
    timer = null;
    if (status !== 'playing') return;
    if (index >= o.length - 1) {
      status = 'ended';
      o.onEnd();
      return;
    }
    show(index + 1);
    schedule();
  }

  const playback: Playback = {
    play() {
      if (status === 'playing') return;
      if (status === 'ended' || index < 0) show(0);
      status = 'playing';
      schedule();
    },
    pause() {
      if (status === 'playing') { clear(); status = 'paused'; }
    },
    seek(i) {
      show(clamp(i));
      if (status === 'playing') schedule();
      else status = 'paused';
    },
    step(delta) {
      playback.pause();
      playback.seek((index < 0 ? 0 : index) + delta);
    },
    stop() {
      clear();
      status = 'idle';
      index = -1;
    },
    setIntervalMs(ms) {
      interval = ms;
      if (status === 'playing') schedule();
    },
    state: () => ({ index, status }),
  };
  return playback;
}
