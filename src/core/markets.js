import { continentOf } from '../data/countries.js';

export const MARKETS = {
  interno: 'Nacional',
  externo: 'Continental',
  internacional: 'Global',
};

// Classifica pelo país da LIGA em que o jogador atua (não pela nacionalidade).
//  - interno:       mesmo país do clube usuário
//  - externo:       outro país do mesmo continente
//  - internacional: demais continentes
export function classifyMarket(userCountry, leagueCountry) {
  const u = String(userCountry || '').toUpperCase();
  const l = String(leagueCountry || '').toUpperCase();
  if (u && u === l) return 'interno';
  const cu = continentOf(u);
  if (cu && cu === continentOf(l)) return 'externo';
  return 'internacional';
}
