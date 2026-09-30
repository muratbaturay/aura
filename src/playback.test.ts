import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPlayback } from './playback';

function setup(length = 4, intervalMs = 100) {
  const frames: number[] = [];
  let ended = 0;
  const p = createPlayback({ length, intervalMs, onFrame: i => frames.push(i), onEnd: () => { ended++; } });
  return { p, frames, ended: () => ended };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createPlayback', () => {
  it('shows frame 0 at once, advances one frame per interval and ends once', () => {
    const { p, frames, ended } = setup();
    p.play();
    expect(frames).toEqual([0]);
    vi.advanceTimersByTime(300);
    expect(frames).toEqual([0, 1, 2, 3]);
    expect(ended()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(ended()).toBe(1);
    expect(p.state()).toEqual({ index: 3, status: 'ended' });
    vi.advanceTimersByTime(1000);
    expect(frames).toEqual([0, 1, 2, 3]);
    expect(ended()).toBe(1);
  });

  it('pauses and resumes from the same frame', () => {
    const { p, frames } = setup();
    p.play(); vi.advanceTimersByTime(100); p.pause();
    vi.advanceTimersByTime(500);
    expect(frames).toEqual([0, 1]);
    p.play(); vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 1, 2]);
  });

  it('continues from a seeked frame while playing', () => {
    const { p, frames } = setup(10);
    p.play(); p.seek(6); vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 6, 7]);
  });

  it('steps by one while paused, clamped to the ends', () => {
    const { p, frames } = setup();
    p.seek(0); p.step(-1); p.step(1); p.step(5);
    expect(frames).toEqual([0, 0, 1, 3]);
    expect(p.state().status).toBe('paused');
  });

  it('never shows a frame after stop', () => {
    const { p, frames } = setup();
    p.play(); p.stop(); vi.advanceTimersByTime(1000);
    expect(frames).toEqual([0]);
    expect(p.state()).toEqual({ index: -1, status: 'idle' });
  });

  it('changes speed mid-play', () => {
    const { p, frames } = setup(10, 100);
    p.play(); p.setIntervalMs(500); vi.advanceTimersByTime(400);
    expect(frames).toEqual([0]);
    vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 1]);
  });

  it('restarts from the first frame when played after the end', () => {
    const { p, frames } = setup(2);
    p.play(); vi.advanceTimersByTime(200);
    p.play();
    expect(frames).toEqual([0, 1, 0]);
  });
});
