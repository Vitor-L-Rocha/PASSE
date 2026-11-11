// "Perfis parecidos": dado um jogador, encontra outros da mesma família de posição com
// perfil estatístico semelhante. Ideia comum em ferramentas de scouting abertas
// (modelos de similaridade por estatísticas por 90 min). Não gera nota de competência:
// só ordena por proximidade de perfil e mostra o que os jogadores têm em comum.

import { getPosition } from '../data/positions.js';
import { characteristicsOf } from './characteristics.js';

// Posições intercambiáveis para comparação de perfil.
const FAMILY = { LW: ['LW', 'RW'], RW: ['RW', 'LW'], LB: ['LB', 'RB'], RB: ['RB', 'LB'] };
export const comparablePositions = (pos) => FAMILY[pos] || [pos];

// Faixas por grupo para normalizar (0–1); percentuais e nota com faixa fixa.
const RANGES = {
  ATT: { goals: [0, 0.8], xg: [0, 0.7], assists: [0, 0.4], shots: [0, 4], keyPasses: [0, 3], dribbles: [0, 3.5], tackles: [0, 2], interceptions: [0, 1.2] },
  MID: { goals: [0, 0.4], xg: [0, 0.35], assists: [0, 0.35], shots: [0, 2.5], keyPasses: [0, 2.6], dribbles: [0, 2.5], tackles: [0, 3.5], interceptions: [0, 2.2] },
  DEF: { goals: [0, 0.2], xg: [0, 0.15], assists: [0, 0.2], shots: [0, 1.2], keyPasses: [0, 1.5], dribbles: [0, 1.5], tackles: [0, 3.5], interceptions: [0, 2.8] },
  GK: { saves: [0, 5] },
};
const FIXED = { passAccuracy: [60, 95], duelsWonPct: [30, 70], aerialWonPct: [30, 80], savePct: [50, 85], rating: [6, 8] };
const MIN_SHARED = 3;

function vector(player) {
  const group = getPosition(player.position)?.group || 'MID';
  const ranges = { ...(RANGES[group] || RANGES.MID), ...FIXED };
  const v = {};
  for (const [k, [lo, hi]] of Object.entries(ranges)) {
    const x = player.stats?.[k];
    if (typeof x === 'number' && Number.isFinite(x)) v[k] = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  }
  return v;
}

const hasSample = (p) => (Number.isFinite(p.minutes) && p.minutes >= 450) || (!Number.isFinite(p.minutes) && Number.isFinite(p.appearances) && p.appearances >= 8);

/** Distância média (0 = idêntico) nas estatísticas que os dois têm; null se pouco comparável. */
export function profileDistance(a, b) {
  const va = vector(a);
  const vb = vector(b);
  const keys = Object.keys(va).filter((k) => k in vb);
  if (keys.length < MIN_SHARED) return null;
  const sq = keys.reduce((s, k) => s + (va[k] - vb[k]) ** 2, 0);
  return Math.sqrt(sq / keys.length);
}

/**
 * @returns {{ id, player, inCommon: string[], onlyTarget: string[] }[]} mais parecidos primeiro
 */
export function similarPlayers(target, pool, { limit = 6, maxBudgetEur } = {}) {
  if (!hasSample(target)) return [];
  const family = comparablePositions(target.position);
  const targetChars = characteristicsOf(target).positive;
  const scored = [];
  for (const p of pool) {
    if (p.id === target.id || !family.includes(p.position) || !hasSample(p)) continue;
    if (maxBudgetEur != null && !(Number.isFinite(p.marketValueEur) && p.marketValueEur <= maxBudgetEur)) continue;
    const d = profileDistance(target, p);
    if (d === null) continue;
    scored.push({ p, d });
  }
  scored.sort((x, y) => x.d - y.d || (y.p.minutes || 0) - (x.p.minutes || 0));
  return scored.slice(0, limit).map(({ p }) => {
    const chars = characteristicsOf(p).positive;
    return { id: p.id, player: p, inCommon: targetChars.filter((c) => chars.includes(c)), onlyTarget: targetChars.filter((c) => !chars.includes(c)) };
  });
}
