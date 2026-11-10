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

const REGISTRY = new Map([[demoProvider.name, demoProvider]]);

export function registerProvider(provider) {
  REGISTRY.set(provider.name, provider);
}

export function activeProviders() {
  const names = (process.env.PASSE_PROVIDERS || 'demo')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return names.map((n) => REGISTRY.get(n)).filter((p) => p && p.isEnabled());
}

export async function searchAll(query) {
  const providers = activeProviders();
  const settled = await Promise.allSettled(providers.map((p) => p.searchPlayers(query)));
  const players = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') players.push(...r.value);
    else errors.push({ provider: providers[i].name, message: r.reason?.message || String(r.reason) });
  });
  return { players, errors, providers: providers.map((p) => p.name) };
}

export async function getPlayerById(id) {
  const source = String(id).split('-')[0];
  const provider = REGISTRY.get(source);
  if (!provider) return null;
  return provider.getPlayer(id);
}
