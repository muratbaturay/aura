/** Deterministic PRNG (mulberry32). Same seed → same sequence, values in [0, 1). */
export function createRng(seed: number): () => number {
  let a = Math.trunc(Math.abs(seed)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fresh seed for a random day (UI only). */
export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 999999);
}

/** Seed box text → seed, or null when blank/invalid (meaning "pick a new one"). */
export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(Math.abs(n)) : null;
}
