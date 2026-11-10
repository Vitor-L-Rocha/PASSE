// Registro de provedores de dados.
//
// Contrato de um provedor:
//   name: string
//   isEnabled(): boolean
//   searchPlayers({ position, maxBudgetEur }) => Promise<Player[]>
//   getPlayer(id) => Promise<Player | null>
//
// Player (formato normalizado usado em todo o PASSE):
//   { id, source, name, age, nationality, foot, heightCm, position, club, league,
//     leagueCountry, marketValueEur, contractUntil, season, appearances, minutes,
//     stats: { ...ver src/core/attributes.js }, links: { transfermarkt?, sofascore? },
//
//     -- campos do dashboard (opcionais; null/[] quando a fonte não fornece) --
//     photoUrl: string | null,
//     characteristics: { positive: string[], negative: string[], source: 'fonte'|'estatisticas' } | null,
//         códigos de src/data/characteristics.js (ordem = relevância). Se a fonte não
//         fornece, o núcleo deriva de `stats` (src/core/characteristics.js).
//     seasons: [{ season, club, league, appearances, minutes, goals, assists,
//                 rating /* nota média da FONTE, ex. SofaScore; null se não houver */ }],
//     titles: [{ name, season, club }],
//     heatmap: { season, competition, points: [{ x: 0-100, y: 0-100, count }] } | null
//         (formato de pontos do SofaScore; x = comprimento do campo, ataque à direita)
//   }
//
// No resumo (listagem) só vão campos leves; o detalhe completo vem de getPlayer(id).
//
// `leagueCountry` (código ISO-2 de src/data/countries.js) é o que define o mercado.
//
// Provedores ativos: variável PASSE_PROVIDERS (lista separada por vírgula).
// Padrão: "tmdata" (dados reais e abertos, ver scripts/sync-data.js); se o índice ainda
// não foi sincronizado, cai para "demo" (fictício). Provedores externos são integrados pelo responsável de integração
// e devem respeitar os termos de uso de cada plataforma.

import { demoProvider } from './demoProvider.js';
import { transfermarktProvider } from './transfermarktProvider.js';
import { apiFootballProvider } from './apiFootballProvider.js';
import { sofascoreProvider } from './sofascoreProvider.js';
import { tmdataProvider } from './tmdataProvider.js';
import { CHARACTERISTICS } from '../data/characteristics.js';

const REGISTRY = new Map();

export function registerProvider(provider) {
  if (!provider || typeof provider.name !== 'string' || !provider.name ||
      !['isEnabled', 'searchPlayers', 'getPlayer'].every((key) => typeof provider[key] === 'function')) {
    throw new TypeError('Contrato de provedor inválido');
  }
  REGISTRY.set(provider.name, provider);
}

for (const provider of [tmdataProvider, demoProvider, transfermarktProvider, apiFootballProvider, sofascoreProvider]) registerProvider(provider);

export function activeProviders() {
  const configured = process.env.PASSE_PROVIDERS?.trim();
  const names = (configured || (tmdataProvider.isEnabled() ? 'tmdata' : 'demo'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(names)].map((n) => REGISTRY.get(n)).filter((p) => {
    try { return p && p.isEnabled(); } catch { return false; }
  });
}

export async function searchAll(query) {
  const providers = activeProviders();
  const settled = await Promise.allSettled(providers.map(async (p) => {
    const players = await p.searchPlayers(query);
    if (!Array.isArray(players)) throw new TypeError('Provedor retornou lista inválida');
    return players;
  }));
  const players = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') players.push(...r.value);
    else errors.push({ provider: providers[i].name, message: r.reason?.message || String(r.reason) });
  });
  return { players, errors, providers: providers.map((p) => p.name) };
}

export async function getPlayerById(id) {
  // Nomes de fontes podem conter hífen (ex.: api-football).
  const provider = activeProviders().sort((a, b) => b.name.length - a.name.length)
    .find((p) => String(id).startsWith(`${p.name}-`));
  if (!provider) return null;
  return provider.getPlayer(id);
}

// Características que as fontes ativas conseguem sustentar. Provedores sem a lista
// `characteristics` (demo, SofaScore) cobrem todo o vocabulário; o enriquecimento
// SofaScore habilitado com IDs associados a uma fonte ativa também cobre tudo.
export function availableCharacteristics() {
  const all = CHARACTERISTICS.map((c) => c.code);
  const providers = activeProviders();
  const sofa = REGISTRY.get('sofascore');
  let enriched = [];
  try { enriched = sofa?.enrichmentCharacteristics?.(providers) || []; } catch { /* desabilitado */ }
  if (providers.some((p) => !Array.isArray(p.characteristics))) return all;
  return all.filter((c) => enriched.includes(c) || providers.some((p) => p.characteristics.includes(c)));
}

export function sourcesInfo() {
  return activeProviders().map((p) => {
    let info;
    try { if (typeof p.info === 'function') info = p.info(); } catch { info = null; }
    return { name: p.name, label: p.label || p.name, ...(info !== undefined ? { info } : {}) };
  });
}
