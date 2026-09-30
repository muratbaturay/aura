// @vitest-environment jsdom
// Wiring tests: the real page (main.ts) in jsdom, with the LLM endpoint stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let llmCalls = 0;

async function loadApp() {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.setItem('aura_llm_config', JSON.stringify({
    apiKey: 'test-key', baseUrl: 'http://llm.test/v1', model: 'test-model', enabled: true,
  }));
  llmCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    llmCalls++;
    const content = JSON.stringify({ residentMessage: 'LLM-RES', staffMessage: 'LLM-STAFF', explanationText: 'LLM-EXPL' });
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  }));
  await import('./main');
}

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function playStory(id: string) {
  el('btnStudio').click();
  document.querySelector<HTMLButtonElement>(`.story-card[data-id="${id}"]`)!.click();
  document.querySelector<HTMLButtonElement>('#speedControl [data-speed="120"]')!.click();
  el('btnSimulate').click();
}

function scrubTo(hour: number) {
  const s = el<HTMLInputElement>('pbScrub');
  s.value = String(hour);
  s.dispatchEvent(new Event('input'));
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('LLM messages during review', () => {
  it('does not show the end-of-run LLM messages at an earlier hour', async () => {
    await loadApp();
    playStory('sundowning');                         // ends at Level 4
    await vi.advanceTimersByTimeAsync(120 * 24 + 50); // run ends
    await vi.advanceTimersByTimeAsync(1000);          // debounce + response
    expect(llmCalls).toBe(1);
    expect(el('interventionContent').textContent).toContain('LLM-RES');

    scrubTo(10);
    expect(el('interventionContent').textContent).not.toContain('LLM-RES');
    expect(el('explanationContent').textContent).not.toContain('LLM-EXPL');
  });

  it('drops a pending end-of-run request when the user scrubs back first', async () => {
    await loadApp();
    playStory('sundowning');
    await vi.advanceTimersByTimeAsync(120 * 24 + 50);
    scrubTo(10);                                      // inside the 600 ms debounce
    await vi.advanceTimersByTimeAsync(2000);
    expect(llmCalls).toBe(0);
    expect(el('interventionContent').textContent).not.toContain('LLM-RES');
  });

  it('ignores the refresh button while a run is paused', async () => {
    await loadApp();
    playStory('uti');
    await vi.advanceTimersByTimeAsync(120 * 4 + 10);   // 04:00, Level 4
    el('pbPlay').click();                               // pause
    el('btnRefreshLLM').click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(llmCalls).toBe(0);
  });
});

describe('controls during a run', () => {
  it('locks the simulator controls only while playing', async () => {
    await loadApp();
    playStory('uti');
    await vi.advanceTimersByTimeAsync(130);
    expect(el<HTMLInputElement>('mobilitySlider').disabled).toBe(true);
    el('pbPlay').click();                               // pause
    expect(el<HTMLInputElement>('mobilitySlider').disabled).toBe(false);
    expect(el<HTMLButtonElement>('btnSimulate').disabled).toBe(false);
    el('pbPlay').click();                               // resume
    expect(el<HTMLInputElement>('mobilitySlider').disabled).toBe(true);
  });

  it('leaves a paused run when a slider is moved by hand', async () => {
    await loadApp();
    playStory('uti');
    await vi.advanceTimersByTimeAsync(130);
    el('pbPlay').click();
    const s = el<HTMLInputElement>('mobilitySlider');
    s.value = '40';
    s.dispatchEvent(new Event('input'));
    expect(el('playbackBar').hidden).toBe(true);
    expect(el('storyChip').hidden).toBe(true);
  });
});
