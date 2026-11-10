import { numberOrNull } from './normalization.js';

export function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export const textOrNull = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
export const seasonOrNull = (value) => typeof value === 'number' && Number.isFinite(value) ? String(value) : textOrNull(value);

// Dados sazonais são totais da fonte, não taxas /90 e não notas de competência.
export function normalizeSeasons(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((s) => s && seasonOrNull(s.season)).map((s) => ({
    season: seasonOrNull(s.season), club: textOrNull(s.club), league: textOrNull(s.league),
    ...Object.fromEntries(['appearances', 'minutes', 'goals', 'assists', 'rating'].map((key) => [key, numberOrNull(s[key])])),
  }));
}

export function normalizeTitles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((t) => t && textOrNull(t.name)).map((t) => ({
    name: textOrNull(t.name), season: seasonOrNull(t.season), club: textOrNull(t.club),
  }));
}

export function normalizeHeatmap(value) {
  if (!value || !Array.isArray(value.points)) return null;
  const points = [];
  for (const p of value.points) {
    if (!p) continue;
    const x = numberOrNull(p.x);
    const y = numberOrNull(p.y);
    const count = p.count == null ? 1 : numberOrNull(p.count);
    if (x == null || y == null || x > 100 || y > 100 || !(count > 0)) continue;
    points.push({ x, y, count });
  }
  return points.length ? { season: seasonOrNull(value.season), competition: textOrNull(value.competition), points } : null;
}
