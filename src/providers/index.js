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
//     stats: { ...ver src/core/attributes.js }, links: { transfermarkt?, sofascore? } }
//
// `leagueCountry` (código ISO-2 de src/data/countries.js) é o que define o mercado.
//
// Provedores ativos: variável PASSE_PROVIDERS (lista separada por vírgula).
// Padrão: "demo". Provedores externos são integrados pelo responsável de integração
// e devem respeitar os termos de uso de cada plataforma.

import { demoProvider } from './demoProvider.js';
import { transfermarktProvider } from './transfermarktProvider.js';
import { apiFootballProvider } from './apiFootballProvider.js';

const REGISTRY = new Map();

export function registerProvider(provider) {
  if (!provider || typeof provider.name !== 'string' || !provider.name ||
      !['isEnabled', 'searchPlayers', 'getPlayer'].every((key) => typeof provider[key] === 'function')) {
    throw new TypeError('Contrato de provedor inválido');
  }
  REGISTRY.set(provider.name, provider);
}

for (const provider of [demoProvider, transfermarktProvider, apiFootballProvider]) registerProvider(provider);

export function activeProviders() {
  const names = (process.env.PASSE_PROVIDERS || 'demo')
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
