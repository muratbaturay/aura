import type { InterventionLevel } from '../types';
import { DEFAULT_BASELINE } from '../baseline';
import { ringSegments, ringGradient, nightArcGradient, ringPoint } from '../ring';

// Geometry as a percentage of the square ring box
const DOT_RADIUS_PCT = 39; // midway across the hour band

/** Build the ring's elements once; `updateRing` then only changes styles and text. */
export function setupRing(container: HTMLElement): void {
  container.innerHTML = `
    <div class="ring" role="img" aria-labelledby="ringNow">
      <div class="ring-night" id="ringNight"></div>
      <div class="ring-mask"></div>
      <div class="ring-hours" id="ringHours"></div>
      <div class="ring-disc">
        <span class="ring-kicker mono">NOW</span>
        <span class="ring-time" id="ringNow"></span>
        <span class="ring-since" id="ringSince"></span>
        <span class="ring-next" id="ringNext"></span>
      </div>
      <span class="ring-dot" id="ringDot"></span>
      <span class="ring-label mono" style="left:50%;top:0">00</span>
      <span class="ring-label mono" style="left:100%;top:50%">06</span>
      <span class="ring-label mono" style="left:50%;top:100%">12</span>
      <span class="ring-label mono" style="left:0;top:50%">18</span>
    </div>`;
}

export function updateRing(
  levels: (InterventionLevel | null)[],
  nowHour: number,
  currentLevel: InterventionLevel,
  sinceHour: number | null,
): void {
  const segments = ringSegments(levels, nowHour, DEFAULT_BASELINE);
  document.getElementById('ringHours')!.style.background = ringGradient(segments);
  document.getElementById('ringNight')!.style.background = nightArcGradient(segments);

  const dot = ringPoint(Math.floor(nowHour) + 0.5, DOT_RADIUS_PCT, 50);
  const dotEl = document.getElementById('ringDot')!;
  dotEl.style.left = `${dot.x}%`;
  dotEl.style.top = `${dot.y}%`;

  const hh = String(Math.floor(nowHour)).padStart(2, '0');
  const mm = String(Math.floor((nowHour % 1) * 60)).padStart(2, '0');
  document.getElementById('ringNow')!.textContent = `${hh}:${mm}`;
  document.getElementById('ringSince')!.textContent = sinceHour === null
    ? `Level ${currentLevel} now`
    : `Level ${currentLevel} since ${String(sinceHour).padStart(2, '0')}:00`;
  const night = segments[Math.floor(nowHour) % 24].isNight;
  document.getElementById('ringNext')!.textContent = night
    ? `Night ends ${String(DEFAULT_BASELINE.sleepEnd).padStart(2, '0')}:00`
    : `Night begins ${String(DEFAULT_BASELINE.sleepStart).padStart(2, '0')}:00`;
}
