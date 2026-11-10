// Ranking por ENCAIXE DE CARACTERÍSTICAS.
//
// O PASSE não atribui notas de competência. Para cada jogador, compara as
// características que o clube procura com os pontos fortes/fracos do atleta
// (informados pela fonte ou derivados das estatísticas) e ordena por:
//   1. quantas características pedidas são pontos fortes do jogador;
//   2. quantas características pedidas são pontos fracos dele (menos é melhor);
//   3. destaque das características atendidas (mais acima na lista da fonte);
//   4. mais minutos jogados na temporada de referência (fato observado, não nota);
//   5. valor de mercado mais próximo do valor esperado (teto).
// Assim, quem aparece primeiro é quem mais se encaixa no pedido, não "o melhor".

import { characteristicsOf, CORE_BY_POSITION } from './characteristics.js';
import { classifyMarket, MARKETS } from './markets.js';

function passesFilters(player, filters = {}) {
  if (filters.foot) {
    if (filters.foot === 'ambidestro' && player.foot !== 'ambidestro') return false;
    if (filters.foot !== 'ambidestro' && player.foot !== filters.foot && player.foot !== 'ambidestro') return false;
  }
  if (filters.maxAge != null && (!Number.isFinite(player.age) || player.age > filters.maxAge)) return false;
  if (filters.minAge != null && (!Number.isFinite(player.age) || player.age < filters.minAge)) return false;
  if (filters.minHeightCm != null && (!Number.isFinite(player.heightCm) || player.heightCm < filters.minHeightCm)) return false;
  return true;
}

export function matchPlayer(player, desired) {
  const characteristics = characteristicsOf(player);
  const matched = desired.filter((c) => characteristics.positive.includes(c));
  const weakIn = desired.filter((c) => characteristics.negative.includes(c));
  const prominence = matched.reduce((sum, c) => sum + characteristics.positive.indexOf(c), 0);
  return { characteristics, matched, weakIn, prominence };
}

/**
 * @param {object[]} players
 * @param {object} query  { country, maxBudgetEur, position, criteria }
 */
export function rankPlayers(players, { country, maxBudgetEur, position, criteria = {}, available } = {}) {
  position = position ? String(position).toUpperCase() : undefined;
  // `available`: características que as fontes ativas conseguem avaliar (as demais são ignoradas).
  const can = (c) => !available || available.includes(c);
  const asked = Array.isArray(criteria.characteristics) ? criteria.characteristics : [];
  const requested = asked.filter(can);
  const ignored = asked.filter((c) => !can(c));
  // Sem características pedidas, usa o perfil típico da posição.
  const usingPositionProfile = requested.length === 0;
  const desired = usingPositionProfile ? (CORE_BY_POSITION[position] || []).filter(can) : requested;

  const results = [];
  for (const p of players) {
    if (position && p.position !== position) continue;
    if (maxBudgetEur != null && (!Number.isFinite(p.marketValueEur) || p.marketValueEur < 0 || p.marketValueEur > maxBudgetEur)) continue;
    if (!passesFilters(p, criteria.filters)) continue;
    const m = matchPlayer(p, desired);
    // Quando o clube pediu características, só entra quem atende pelo menos uma —
    // exceto jogadores SEM dados de desempenho na fonte: eles entram no fim da lista,
    // sinalizados, para que ligas sem estatísticas não sumam do relatório.
    const noData = m.characteristics.source === 'indisponivel';
    if (!usingPositionProfile && m.matched.length === 0 && !noData) continue;
    results.push({
      ...p,
      characteristics: m.characteristics,
      match: { matched: m.matched, weakIn: m.weakIn, desiredCount: desired.length, noData },
      _prominence: m.prominence,
      market: classifyMarket(country, p.leagueCountry),
    });
  }
  results.sort(
    (a, b) =>
      b.match.matched.length - a.match.matched.length ||
      Number(a.match.noData) - Number(b.match.noData) ||
      a.match.weakIn.length - b.match.weakIn.length ||
      a._prominence - b._prominence ||
      (b.minutes || 0) - (a.minutes || 0) ||
      b.marketValueEur - a.marketValueEur
  );
  for (const r of results) delete r._prominence;

  const markets = Object.fromEntries(Object.keys(MARKETS).map((k) => [k, []]));
  for (const r of results) markets[r.market].push(r);
  return { desired, ignored, usingPositionProfile, total: results.length, markets };
}
