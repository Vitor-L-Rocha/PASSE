// Calcula o quanto cada jogador se ENCAIXA no perfil pedido (0–100).
// Importante: é um índice de aderência ao perfil, não de "qualidade geral".
// Um jogador mediano que tem exatamente as características pedidas pode
// ficar acima de um craque com perfil diferente.

import { ATTRIBUTES, getPosition } from '../data/positions.js';
import { deriveAttributes } from './attributes.js';
import { classifyMarket, MARKETS } from './markets.js';

const USER_WEIGHT_MULTIPLIER = 1.6; // características escritas pesam mais que o perfil base da posição

function buildWeights(positionCode, criteria) {
  const weights = { ...(getPosition(positionCode)?.base || {}) };
  for (const [k, v] of Object.entries(criteria.weights || {})) {
    weights[k] = (weights[k] || 0) + v * USER_WEIGHT_MULTIPLIER;
  }
  return weights;
}

function passesFilters(player, filters = {}) {
  if (filters.foot) {
    if (filters.foot === 'ambidestro' && player.foot !== 'ambidestro') return false;
    if (filters.foot !== 'ambidestro' && player.foot !== filters.foot && player.foot !== 'ambidestro') return false;
  }
  if (filters.maxAge && player.age > filters.maxAge) return false;
  if (filters.minAge && player.age < filters.minAge) return false;
  if (filters.minHeightCm && player.heightCm && player.heightCm < filters.minHeightCm) return false;
  return true;
}

export function scorePlayer(player, weights) {
  const attributes = player.attributes || deriveAttributes(player.stats, player);
  let sum = 0;
  let total = 0;
  const contributions = [];
  for (const [attr, w] of Object.entries(weights)) {
    const value = attr === '_rating' ? ((player.stats?.rating ?? 6.5) - 5.5) * (100 / 3) : attributes[attr];
    if (value === undefined) continue;
    const v = Math.max(0, Math.min(100, value));
    sum += v * w;
    total += w;
    contributions.push({ attr, label: ATTRIBUTES[attr] || 'Consistência', value: Math.round(v), weight: w });
  }
  // Pequeno ajuste por minutagem: dados de quem joga pouco são menos confiáveis.
  const reliability = Math.min(1, (player.minutes || 0) / 900);
  const raw = total ? sum / total : 50;
  const fit = Math.round(raw * (0.85 + 0.15 * reliability));
  const strengths = contributions
    .filter((c) => c.weight >= 2)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  return { fit, attributes, strengths };
}

/**
 * @param {object[]} players  jogadores já filtrados por posição pelo provedor
 * @param {object} query  { country, maxBudgetEur, position, criteria }
 */
export function rankPlayers(players, { country, maxBudgetEur, position, criteria }) {
  const weights = buildWeights(position, criteria);
  const results = [];
  for (const p of players) {
    if (position && p.position !== position) continue;
    if (maxBudgetEur && p.marketValueEur > maxBudgetEur) continue;
    if (!passesFilters(p, criteria.filters)) continue;
    const { fit, attributes, strengths } = scorePlayer(p, weights);
    results.push({
      ...p,
      attributes,
      fit,
      strengths,
      market: classifyMarket(country, p.leagueCountry),
    });
  }
  results.sort((a, b) => b.fit - a.fit || a.marketValueEur - b.marketValueEur);

  const markets = Object.fromEntries(Object.keys(MARKETS).map((k) => [k, []]));
  for (const r of results) markets[r.market].push(r);
  return { weights, total: results.length, markets };
}
