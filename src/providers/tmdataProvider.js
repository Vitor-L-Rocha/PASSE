// Índice local CC0: nenhuma requisição em tempo de busca. Os clubes e valores
// são os do snapshot; generatedAt do índice não significa atualização da origem.
import fs from 'node:fs';
import path from 'node:path';
import { tmdataDirectory, apiFootballDirectory } from './tmdataPaths.js';
import { getCountry } from '../data/countries.js';
import { getPosition } from '../data/positions.js';
import { matchesQuery } from './normalization.js';
import { normalizeSeasons, safeUrl } from './dashboard.js';

const BASE_CHARACTERISTICS = ['finalizacao', 'criacao'];
// Avaliáveis com as estatísticas da API-Football (sem dados de cruzamento, jogo aéreo ou velocidade).
const RECENT_CHARACTERISTICS = ['drible', 'passesDecisivos', 'desarme', 'interceptacao', 'duelosNoChao', 'consistencia', 'reflexos'];

// Sobrepõe ao snapshot do índice os dados da temporada ATUAL vindos da API-Football:
// clube e liga atuais, minutos, estatísticas e nota da fonte. Valor de mercado,
// contrato e foto continuam vindo do índice.
function applyRecent(p, r, nonnegative) {
  const stats = r.stats && typeof r.stats === 'object'
    ? Object.fromEntries(Object.entries(r.stats).filter(([, v]) => nonnegative(v) != null)) : {};
  if (r.team) p.club = String(r.team);
  if (r.leagueName) p.league = String(r.leagueName);
  if (getCountry(r.leagueCountry)) p.leagueCountry = getCountry(r.leagueCountry).code;
  if (nonnegative(r.minutes)) {
    p.minutes = r.minutes;
    p.appearances = nonnegative(r.appearances);
    p.season = r.season;
    p.stats = stats;
  }
  if (!p.photoUrl) p.photoUrl = safeUrl(r.photo);
  const row = { season: r.season, club: r.team || null, league: r.leagueName || null, appearances: nonnegative(r.appearances),
    minutes: nonnegative(r.minutes), goals: nonnegative(r.goals), assists: nonnegative(r.assists), rating: nonnegative(r.rating) };
  p.seasons = [row, ...p.seasons.filter((s) => !(s.season === row.season && s.club === row.club))];
  p.apiFootballId = Number.isInteger(r.apiId) ? r.apiId : null;
  p.recent = { source: 'API-Football', season: r.season, fetchedAt: r.fetchedAt || null };
}

export function createTmdataProvider({ env = process.env, now = () => new Date() } = {}) {
  let loaded;
  function load() {
    const file = path.join(tmdataDirectory(env.PASSE_TMDATA_DIR), 'players.json');
    let stat;
    try { stat = fs.statSync(file); } catch { loaded = null; return null; }
    if (!stat.isFile()) return null;
    const enrichFile = path.join(apiFootballDirectory(env.PASSE_API_FOOTBALL_DIR), 'enrichment.json');
    let enrichStat = null;
    try { enrichStat = fs.statSync(enrichFile); } catch { /* sem dados recentes */ }
    const signature = `${file}|${stat.mtimeMs}|${stat.ctimeMs}|${stat.size}|${stat.ino}|${enrichStat?.mtimeMs ?? '-'}|${enrichStat?.size ?? '-'}`;
    if (loaded?.signature === signature) return loaded;
    let recent = {};
    if (enrichStat) {
      try { recent = JSON.parse(fs.readFileSync(enrichFile, 'utf8')).players || {}; } catch { recent = {}; }
    }
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
        seasons: normalizeSeasons(p.seasons), titles: null, heatmap: null, // fonte não informa títulos nem mapa de calor
        characteristics: null });
      const r = recent[p.id];
      if (r) applyRecent(byId.get(p.id), r, nonnegative);
    }
    if (index.players.length && !byId.size) throw new Error('Índice sem jogadores válidos; rode npm run sync-data.');
    const recentCount = [...byId.values()].filter((p) => p.recent).length;
    loaded = { signature, index, byId, recentCount };
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
    // Com dados recentes da API-Football, mais características passam a ser avaliáveis.
    get characteristics() {
      let hasRecent = false;
      try { hasRecent = Boolean(load()?.recentCount); } catch { /* índice inválido */ }
      return hasRecent ? [...BASE_CHARACTERISTICS, ...RECENT_CHARACTERISTICS] : [...BASE_CHARACTERISTICS];
    },
    isEnabled() { try { return Boolean(load()?.byId.size); } catch { return false; } },
    info() {
      const l = load();
      return l ? { ...l.index.source, generatedAt: l.index.generatedAt, players: l.byId.size, recentPlayers: l.recentCount } : null;
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
