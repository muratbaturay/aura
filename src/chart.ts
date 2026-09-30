import type { ResidentBaseline, CurrentState, SimulationSnapshot } from './types';

const COLORS = {
  baseline: 'var(--c-text-muted)',
  current: 'var(--c-text)',
  baselineFill: 'color-mix(in srgb, var(--c-text-muted) 15%, transparent)',
  currentFill: 'color-mix(in srgb, var(--c-text) 12%, transparent)',
  grid: 'var(--c-divider)',
  axis: 'var(--c-text-dim)',
  label: 'var(--c-text-muted)',
  nightBand: 'var(--c-bg-overlay)',
};

export function renderComparisonChart(
  container: HTMLElement,
  baseline: ResidentBaseline,
  state: CurrentState
): void {
  const metrics = [
    { label: 'Mobility', baseline: baseline.mobilityMean, current: state.mobility },
    { label: 'Restlessness', baseline: baseline.restlessnessMean, current: state.restlessness },
    { label: 'Speech Drift', baseline: baseline.speechMean, current: state.speechDrift },
    { label: 'Social Isolation', baseline: baseline.socialMean, current: state.socialIsolation },
  ];

  const w = 380, h = 200;
  const pad = { top: 25, right: 20, bottom: 40, left: 45 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const barGroupW = plotW / metrics.length;
  const barW = barGroupW * 0.30;

  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">`;

  // Grid lines
  for (let v = 0; v <= 100; v += 25) {
    const y = pad.top + plotH - (v / 100) * plotH;
    svg += `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="${COLORS.grid}" stroke-width="0.5"/>`;
    svg += `<text x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${COLORS.axis}">${v}</text>`;
  }

  metrics.forEach((m, i) => {
    const cx = pad.left + barGroupW * i + barGroupW / 2;
    const bH = (m.baseline / 100) * plotH;
    const cH = (m.current / 100) * plotH;
    const bx = cx - barW - 2;
    const cx2 = cx + 2;

    // Baseline bar
    svg += `<rect x="${bx}" y="${pad.top + plotH - bH}" width="${barW}" height="${bH}" rx="3" fill="${COLORS.baselineFill}" stroke="${COLORS.baseline}" stroke-width="1.2"/>`;
    // Current bar
    svg += `<rect x="${cx2}" y="${pad.top + plotH - cH}" width="${barW}" height="${cH}" rx="3" fill="${COLORS.currentFill}" stroke="${COLORS.current}" stroke-width="1.2"/>`;

    // Value labels
    svg += `<text x="${bx + barW / 2}" y="${pad.top + plotH - bH - 4}" text-anchor="middle" font-size="8" fill="${COLORS.baseline}">${Math.round(m.baseline)}</text>`;
    svg += `<text x="${cx2 + barW / 2}" y="${pad.top + plotH - cH - 4}" text-anchor="middle" font-size="8" fill="${COLORS.current}">${Math.round(m.current)}</text>`;

    // Label
    svg += `<text x="${cx}" y="${h - pad.bottom + 16}" text-anchor="middle" font-size="9" fill="${COLORS.label}">${m.label}</text>`;
  });

  // Legend
  svg += `<rect x="${pad.left}" y="6" width="10" height="10" rx="2" fill="${COLORS.baselineFill}" stroke="${COLORS.baseline}" stroke-width="1"/>`;
  svg += `<text x="${pad.left + 14}" y="14" font-size="9" fill="${COLORS.baseline}">Baseline</text>`;
  svg += `<rect x="${pad.left + 70}" y="6" width="10" height="10" rx="2" fill="${COLORS.currentFill}" stroke="${COLORS.current}" stroke-width="1"/>`;
  svg += `<text x="${pad.left + 84}" y="14" font-size="9" fill="${COLORS.current}">Current</text>`;

  svg += `</svg>`;
  container.innerHTML = svg;
}

export function renderTimelineChart(
  container: HTMLElement,
  snapshots: SimulationSnapshot[]
): void {
  if (snapshots.length === 0) {
    container.innerHTML = '<p style="color:var(--c-text-dim);font-size:13px;">Run a 24h simulation to see trends.</p>';
    return;
  }

  const w = 380, h = 180;
  const pad = { top: 25, right: 15, bottom: 35, left: 40 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const series: { label: string; color: string; data: number[] }[] = [
    { label: 'Fall', color: 'var(--c-level-4)', data: snapshots.map(s => s.risks.fall) },
    { label: 'Cognitive', color: 'var(--c-amber)', data: snapshots.map(s => s.risks.cognitive) },
    { label: 'Loneliness', color: 'var(--c-blue)', data: snapshots.map(s => s.risks.loneliness) },
  ];

  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">`;

  // Night band
  const nightRanges = [[0, 6], [22, 24]];
  for (const [s, e] of nightRanges) {
    const x1 = pad.left + (s / 24) * plotW;
    const x2 = pad.left + (e / 24) * plotW;
    svg += `<rect x="${x1}" y="${pad.top}" width="${x2 - x1}" height="${plotH}" fill="${COLORS.nightBand}"/>`;
  }

  // Grid
  for (let v = 0; v <= 100; v += 25) {
    const y = pad.top + plotH - (v / 100) * plotH;
    svg += `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="${COLORS.grid}" stroke-width="0.5"/>`;
    svg += `<text x="${pad.left - 5}" y="${y + 3}" text-anchor="end" font-size="8" fill="${COLORS.axis}">${v}</text>`;
  }

  // X axis labels
  for (let hh = 0; hh <= 24; hh += 4) {
    const x = pad.left + (hh / 24) * plotW;
    svg += `<text x="${x}" y="${h - pad.bottom + 14}" text-anchor="middle" font-size="8" fill="${COLORS.axis}">${hh}h</text>`;
  }

  // Lines
  for (const s of series) {
    const points = s.data.map((v, i) => {
      const x = pad.left + (i / 23) * plotW; // hour i on the 0–24 h axis (one point at the first hour)
      const y = pad.top + plotH - (v / 100) * plotH;
      return `${x},${y}`;
    });
    svg += `<polyline points="${points.join(' ')}" fill="none" stroke="${s.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  // Legend
  let lx = pad.left;
  for (const s of series) {
    svg += `<line x1="${lx}" y1="10" x2="${lx + 14}" y2="10" stroke="${s.color}" stroke-width="2"/>`;
    svg += `<text x="${lx + 18}" y="13" font-size="9" fill="${COLORS.label}">${s.label}</text>`;
    lx += 75;
  }

  svg += `</svg>`;
  container.innerHTML = svg;
}
