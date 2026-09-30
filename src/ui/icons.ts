// Inline stroke icons (currentColor), decorative unless the caller labels them.
const svg = (body: string, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  brand: `<svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="13" cy="13" r="11.5" opacity="0.35"/><circle cx="13" cy="13" r="7.5" opacity="0.65"/><circle cx="13" cy="13" r="3.5"/></svg>`,
  sun: svg('<path d="M12 3v3M5.6 7.6l2.1 2.1M18.4 7.6l-2.1 2.1M3 16h18M7 16a5 5 0 0 1 10 0M8 20h8"/>', 20),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>', 20),
  sunSmall: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 16),
  moonSmall: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>', 16),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 16),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  chevron: svg('<path d="M6 9l6 6 6-6"/>', 16),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  shuffle: svg('<path d="M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 5l2 2-2 2M18 15l2 2-2 2"/>', 16),
  play: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>`,
  pause: svg('<path d="M8 5v14M16 5v14"/>', 20),
  prev: svg('<path d="M18 6l-8 6 8 6V6zM6 6v12"/>'),
  next: svg('<path d="M6 6l8 6-8 6V6zM18 6v12"/>'),
  speaker: svg('<path d="M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 0 1 0 7"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0"/>'),
  lamp: svg('<path d="M9 3h6l3 7H6l3-7zM12 10v8M8 21h8"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', 16),
};
