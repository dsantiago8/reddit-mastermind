export function startOfWeekISO(d: Date) {
  // Monday as start-of-week
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // Sun=0
  const diff = (day === 0 ? -6 : 1) - day;
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function addMinutes(date: Date, minutes: number) {
  const d = new Date(date);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d;
}

export function iso(date: Date) {
  return date.toISOString();
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickOne<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffle<T>(rng: () => number, arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Weighted pick without replacement.
 */
export function weightedSampleUnique<T extends { id: string }>(
  rng: () => number,
  items: T[],
  weight: (item: T) => number,
  k: number
): T[] {
  const pool = [...items];
  const out: T[] = [];

  for (let n = 0; n < k && pool.length > 0; n++) {
    const total = pool.reduce((s, it) => s + Math.max(0, weight(it)), 0);
    if (total <= 0) {
      out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      continue;
    }

    let r = rng() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= Math.max(0, weight(pool[idx]));
      if (r <= 0) break;
    }
    out.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]);
  }
  return out;
}

export function looksManufactured(text: string) {
  const t = text.toLowerCase();
  // crude heuristics: too salesy, too CTA-heavy
  const flags = [
    /use my tool/,
    /sign up/,
    /try it now/,
    /discount/,
    /limited time/,
    /dm me/,
    /link in bio/,
    /affiliat/,
  ];
  return flags.some((re) => re.test(t));
}
