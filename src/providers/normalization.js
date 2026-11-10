import { getCountry } from '../data/countries.js';
import { getPosition } from '../data/positions.js';

export function numberOrNull(value) {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function per90(value, minutes) {
  const n = numberOrNull(value);
  return n != null && minutes > 0 ? n * 90 / minutes : undefined;
}

const POSITIONS = {
  'goalkeeper': 'GK', 'centre-back': 'CB', 'center-back': 'CB',
  'left-back': 'LB', 'right-back': 'RB', 'defensive midfield': 'DM',
  'central midfield': 'CM', 'attacking midfield': 'AM', 'left winger': 'LW',
  'right winger': 'RW', 'centre-forward': 'ST', 'center-forward': 'ST',
};
export function positionCode(value) {
  return getPosition(value)?.code || POSITIONS[String(value || '').toLowerCase()] || null;
}

export function footCode(value) {
  return ({ left: 'esquerdo', right: 'direito', both: 'ambidestro',
    esquerdo: 'esquerdo', direito: 'direito', ambidestro: 'ambidestro' })[String(value || '').toLowerCase()] || null;
}

// O país é informado pelo catálogo de LIGAS, nunca por cidadania/local de nascimento.
export function readCatalog(raw) {
  try {
    const entries = JSON.parse(raw || '[]');
    if (!Array.isArray(entries)) return [];
    if (!entries.every((e) => e && /^\d+$/.test(String(e.id)) && getCountry(e.country) && typeof e.name === 'string' && e.name.trim())) return [];
    return entries.map((e) => ({ ...e, id: String(e.id), country: getCountry(e.country).code }));
  } catch { return []; }
}

export function matchesQuery(player, { position, maxBudgetEur } = {}) {
  return (!position || player.position === String(position).toUpperCase()) &&
    (maxBudgetEur == null || (player.marketValueEur != null && player.marketValueEur <= maxBudgetEur));
}
