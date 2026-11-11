// Títulos de um jogador via API-Football (rota /trophies). Uma consulta por jogador,
// feita só quando a ficha é aberta, guardada em cache por 30 dias para poupar a cota.

import fs from 'node:fs';
import path from 'node:path';
import { apiFootballDirectory } from './tmdataPaths.js';
import { createClient } from './apiFootballClient.js';

const TTL_MS = 30 * 24 * 3600 * 1000;
const inflight = new Map();

// "Winner" = conquistou. Vice-campeonatos não entram como título.
export function normalizeTrophies(rows) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const out = [];
  for (const t of rows) {
    if (String(t?.place || '').toLowerCase() !== 'winner' || !t.league) continue;
    const name = t.country && !String(t.league).includes(t.country) ? `${t.league} (${t.country})` : String(t.league);
    const season = t.season ? String(t.season) : null;
    const key = `${name}|${season}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, season, club: null });
  }
  return out.sort((a, b) => String(b.season || '').localeCompare(String(a.season || '')));
}

/**
 * @returns {Promise<{titles: object[], source: string} | null>} null = indisponível (sem chave, sem id ou erro)
 */
export async function titlesFor(apiId, { env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (!Number.isInteger(apiId) || !env.PASSE_API_FOOTBALL_KEY) return null;
  const file = path.join(apiFootballDirectory(env.PASSE_API_FOOTBALL_DIR), 'trophies', `${apiId}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (now() - cached.fetchedAt < TTL_MS) return { titles: cached.titles, source: 'API-Football' };
  } catch { /* sem cache */ }
  if (inflight.has(apiId)) return inflight.get(apiId);
  const job = (async () => {
    try {
      const client = createClient({ key: env.PASSE_API_FOOTBALL_KEY, baseUrl: env.PASSE_API_FOOTBALL_URL || undefined, fetchImpl });
      const json = await client.get('trophies', { player: apiId });
      const titles = normalizeTrophies(json.response);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ fetchedAt: now(), titles }));
      return { titles, source: 'API-Football' };
    } catch {
      return null; // cota, chave ou rede: a ficha mostra "indisponível" sem quebrar
    } finally {
      inflight.delete(apiId);
    }
  })();
  inflight.set(apiId, job);
  return job;
}
