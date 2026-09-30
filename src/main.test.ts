// @vitest-environment jsdom
// Wiring tests: the real page (main.ts) in jsdom, with the LLM endpoint stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let llmCalls = 0;

async function loadApp() {
  vi.resetModules();
  document.documentElement.removeAttribute('data-theme');
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

function setTime(hour: number) {
  const s = el<HTMLInputElement>('timeSlider');
  s.value = String(hour);
  s.dispatchEvent(new Event('input'));
}
const theme = () => document.documentElement.dataset.theme;

describe('theme setting', () => {
  it('is light by default, even at night', async () => {
    await loadApp();
    setTime(3);
    expect(theme()).toBe('day');
    expect(el('themeLight').getAttribute('aria-checked')).toBe('true');
  });

  it('remembers dark across a reload', async () => {
    await loadApp();
    el('themeDark').click();
    setTime(14);
    expect(theme()).toBe('night');
    await loadApp();
    expect(theme()).toBe('night');
    expect(el('themeDark').getAttribute('aria-checked')).toBe('true');
  });

  it('follows the clock when chosen', async () => {
    await loadApp();
    el('themeAuto').click();
    setTime(3);
    expect(theme()).toBe('night');
    setTime(14);
    expect(theme()).toBe('day');
  });
});

describe('day log', () => {
  it('jumps to the hour of an event mark when it is clicked', async () => {
    await loadApp();
    playStory('restless-night');
    await vi.advanceTimersByTimeAsync(120 * 24 + 50);   // run complete
    const mark = document.querySelector<HTMLButtonElement>('[data-lane="bed-exit"] .lane-mark[data-hour="4"]');
    expect(mark).not.toBeNull();
    mark!.click();
    expect(el('clockTime').textContent).toBe('04:00');
    expect(el('logDetail').textContent).toContain('Bed exit detected');
  });
});

describe('residents', () => {
  function pickResident(id: string) {
    el('btnResident').click();
    document.querySelector<HTMLButtonElement>(`#residentMenu [data-id="${id}"]`)!.click();
  }

  it('switches resident: name and usual levels load', async () => {
    await loadApp();
    expect(el('residentName').textContent).toBe('Eleanor, 82');
    pickResident('walter');
    expect(el('residentName').textContent).toBe('Walter, 88');
    expect(el<HTMLInputElement>('mobilitySlider').value).toBe('42');
    expect(el('btnResident').getAttribute('aria-expanded')).toBe('false');
  });

  it('ends a run when the resident changes', async () => {
    await loadApp();
    playStory('uti');
    await vi.advanceTimersByTimeAsync(120 * 4 + 10);
    pickResident('joseph');
    expect(el('playbackBar').hidden).toBe(true);
    expect(el('storyChip').hidden).toBe(true);
    expect(el('residentName').textContent).toBe('Joseph, 85');
  });

  it("selects a story's resident when the story is chosen", async () => {
    await loadApp();
    el('btnStudio').click();
    document.querySelector<HTMLButtonElement>('.story-card[data-id="sundowning"]')!.click();
    expect(el('residentName').textContent).toBe('Margaret, 79');
  });

  it("shows each area's usual level on the status card", async () => {
    await loadApp();
    expect(el('fallUsual').textContent).toMatch(/usual \d+/);
  });
});

describe('final review fixes: page', () => {
  it('drops a story choice whose resident is switched away in the header', async () => {
    await loadApp();
    el('btnStudio').click();
    document.querySelector<HTMLButtonElement>('.story-card[data-id="sundowning"]')!.click();
    el('btnResident').click();
    document.querySelector<HTMLButtonElement>('#residentMenu [data-id="walter"]')!.click();
    expect(el('btnSimulateLabel').textContent).toBe('Play a random day');
  });

  it("labels the usual tick as 'usual when up' when she is up at night", async () => {
    await loadApp();
    setTime(3);
    const r = el<HTMLInputElement>('restlessnessSlider');
    r.value = '75'; r.dispatchEvent(new Event('input'));
    expect(el('fallUsual').textContent).toMatch(/usual when up/);
  });
});

describe('how it works panel', () => {
  it('opens from the header with the live model and closes on Esc', async () => {
    await loadApp();
    el('btnHow').click();
    expect(el('howPanel').hidden).toBe(false);
    expect(el('howPanel').textContent).toContain('max(50, 100 − usual)');
    expect(el('howPanel').textContent).toContain('SpO2 amber < 88, red < 85');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(el('howPanel').hidden).toBe(true);
    expect(document.activeElement).toBe(el('btnHow'));
  });
});
