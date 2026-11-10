// Índice local CC0: nenhuma requisição em tempo de busca. Os clubes e valores
// são os do snapshot; generatedAt do índice não significa atualização da origem.
import fs from 'node:fs';
import path from 'node:path';
import { tmdataDirectory } from './tmdataPaths.js';
import { getCountry } from '../data/countries.js';
import { getPosition } from '../data/positions.js';
import { matchesQuery } from './normalization.js';
import { normalizeSeasons, normalizeTitles, safeUrl } from './dashboard.js';

export function createTmdataProvider({ env = process.env, now = () => new Date() } = {}) {
  let loaded;
  function load() {
    const file = path.join(tmdataDirectory(env.PASSE_TMDATA_DIR), 'players.json');
    let stat;
    try { stat = fs.statSync(file); } catch { loaded = null; return null; }
    if (!stat.isFile()) return null;
    const signature = `${file}|${stat.mtimeMs}|${stat.ctimeMs}|${stat.size}|${stat.ino}`;
    if (loaded?.signature === signature) return loaded;
    let index;
    try { index = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw new Error('Índice de dados reais ilegível; rode npm run sync-data.'); }
    if (!Array.isArray(index?.players)) throw new Error('Índice de dados reais inválido; rode npm run sync-data.');
    const byId = new Map();
    for (const p of index.players) {
      if (!p || !/^tmdata-\d+$/.test(p.id) || p.source !== 'tmdata' || typeof p.name !== 'string' || !p.name.trim() ||
          !getPosition(p.position) || !getCountry(p.leagueCountry)) continue;
      const nonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
      // Uma linha ruim não pode tornar o índice inteiro inutilizável ou falsificar orçamento.
      byId.set(p.id, { ...p, position: getPosition(p.position).code, leagueCountry: getCountry(p.leagueCountry).code,
        marketValueEur: nonnegative(p.marketValueEur), age: nonnegative(p.age), heightCm: nonnegative(p.heightCm),
        minutes: nonnegative(p.minutes), appearances: nonnegative(p.appearances),
        stats: p.stats && typeof p.stats === 'object' && !Array.isArray(p.stats)
          ? Object.fromEntries(Object.entries(p.stats).filter(([, value]) => nonnegative(value) != null)) : {},
        photoUrl: safeUrl(p.photoUrl),
        links: safeUrl(p.links?.transfermarkt) ? { transfermarkt: safeUrl(p.links.transfermarkt) } : {},
        seasons: normalizeSeasons(p.seasons), titles: normalizeTitles(p.titles), heatmap: null,
        characteristics: null });
    }
    if (index.players.length && !byId.size) throw new Error('Índice sem jogadores válidos; rode npm run sync-data.');
    loaded = { signature, index, byId };
    return loaded;
  }
  function snapshot(player) {
    const result = structuredClone(player);
    // A idade não deve congelar no dia da sincronização do arquivo.
    if (/^\d{4}-\d{2}-\d{2}$/.test(result.dateOfBirth || '')) {
      const birth = new Date(`${result.dateOfBirth}T00:00:00Z`);
      const today = now();
      let age = today.getUTCFullYear() - birth.getUTCFullYear();
      if (today.getUTCMonth() < birth.getUTCMonth() ||
          (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())) age--;
      result.age = Number.isFinite(birth.getTime()) && birth.toISOString().slice(0, 10) === result.dateOfBirth && age >= 0 && age <= 100 ? age : null;
    }
    return result;
  }
  return {
    name: 'tmdata', label: 'transfermarkt-datasets (dados abertos, CC0)',
    characteristics: ['finalizacao', 'criacao'],
    isEnabled() { try { return Boolean(load()?.byId.size); } catch { return false; } },
    info() {
      const l = load();
      return l ? { ...l.index.source, generatedAt: l.index.generatedAt, players: l.byId.size } : null;
    },
    async searchPlayers(query = {}) {
      const l = load();
      if (!l) throw new Error('Dados reais ainda não sincronizados. Rode: npm run sync-data');
      return [...l.byId.values()].filter((p) => matchesQuery(p, query)).map(snapshot);
    },
    async getPlayer(id) {
      if (!/^tmdata-\d+$/.test(String(id))) return null;
      const player = load()?.byId.get(String(id));
      return player ? snapshot(player) : null;
    },
  };
}

export const tmdataProvider = createTmdataProvider();
