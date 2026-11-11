// Índice local CC0: nenhuma requisição em tempo de busca. Os clubes e valores
// são os do snapshot; generatedAt do índice não significa atualização da origem.
import fs from 'node:fs';
import path from 'node:path';
import { tmdataDirectory, apiFootballDirectory, goalApiDirectory, reepDirectory } from './tmdataPaths.js';
import { getCountry } from '../data/countries.js';
import { getPosition } from '../data/positions.js';
import { matchesQuery } from './normalization.js';
import { normalizeSeasons, safeUrl } from './dashboard.js';

const BASE_CHARACTERISTICS = ['finalizacao', 'criacao'];
// Avaliáveis com as estatísticas da API-Football (sem dados de cruzamento, jogo aéreo ou velocidade).
// (GOAL API também traz precisão de passe.)
const RECENT_CHARACTERISTICS = ['drible', 'passesDecisivos', 'desarme', 'interceptacao', 'duelosNoChao', 'consistencia', 'reflexos', 'passe'];

// Sobrepõe ao snapshot do índice os dados da temporada ATUAL vindos da API-Football:
// clube e liga atuais, minutos, estatísticas e nota da fonte. Valor de mercado,
// contrato e foto continuam vindo do índice.
function applyRecent(p, r, nonnegative) {
  const stats = r.stats && typeof r.stats === 'object'
    ? Object.fromEntries(Object.entries(r.stats).filter(([, v]) => nonnegative(v) != null)) : {};
  // Temporada ANTERIOR (plano que não libera a atual): não sobrescreve clube/liga com
  // dado velho e só usa as estatísticas se o jogador não tiver nenhuma no índice.
  const current = r.current !== false;
  if (current && r.team) p.club = String(r.team);
  if (current && r.leagueName) p.league = String(r.leagueName);
  if (current && getCountry(r.leagueCountry)) p.leagueCountry = getCountry(r.leagueCountry).code;
  // Amostra mínima para usar as estatísticas no ranking (mesmo critério do índice).
  const hasSample = nonnegative(r.minutes) >= 450 || (!nonnegative(r.minutes) && nonnegative(r.appearances) >= 8);
  const hasOwnStats = nonnegative(p.minutes) || (p.recent && p.stats && Object.keys(p.stats).length);
  if (hasSample && (current || !hasOwnStats)) {
    p.minutes = nonnegative(r.minutes); // GOAL API não informa minutos: taxas por jogo
    p.perGame = Boolean(r.perGame);
    p.appearances = nonnegative(r.appearances);
    p.season = r.season;
    p.stats = stats;
  }
  if (!p.photoUrl) p.photoUrl = safeUrl(r.photo);
  const row = { season: r.season, club: r.team || null, league: r.leagueName || null, appearances: nonnegative(r.appearances),
    minutes: nonnegative(r.minutes), goals: nonnegative(r.goals), assists: nonnegative(r.assists), rating: nonnegative(r.rating) };
  p.seasons = [row, ...p.seasons.filter((s) => !(s.season === row.season && s.club === row.club))]
    .sort((a, b) => String(b.season).localeCompare(String(a.season)));
  if (Number.isInteger(r.apiId)) p.apiFootballId = r.apiId;
  p.recent = { source: r.source || 'API-Football', season: r.season, current, perGame: Boolean(r.perGame), fetchedAt: r.fetchedAt || null };
}

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'jogador';

// Links para o perfil do jogador em cada plataforma (IDs vindos do Reep, CC0).
// O PASSE só aponta para as páginas; quem abre é o scout.
export function profileLinks(name, ids = {}) {
  const ok = (v, re) => (typeof v === 'string' && re.test(v) ? v : null);
  const links = {};
  const sofascore = ok(ids.sofascore, /^\d+$/);
  const fotmob = ok(ids.fotmob, /^\d+$/);
  const fbref = ok(ids.fbref, /^[0-9a-f]{8}$/);
  const whoscored = ok(ids.whoscored, /^\d+$/);
  const understat = ok(ids.understat, /^\d+$/);
  if (sofascore) links.sofascore = `https://www.sofascore.com/football/player/${slug(name)}/${sofascore}`;
  if (fotmob) links.fotmob = `https://www.fotmob.com/players/${fotmob}/${slug(name)}`;
  if (fbref) links.fbref = `https://fbref.com/en/players/${fbref}/`;
  if (whoscored) links.whoscored = `https://www.whoscored.com/Players/${whoscored}`;
  if (understat) links.understat = `https://understat.com/player/${understat}`;
  return links;
}

export function createTmdataProvider({ env = process.env, now = () => new Date() } = {}) {
  let loaded;
  function load() {
    const file = path.join(tmdataDirectory(env.PASSE_TMDATA_DIR), 'players.json');
    let stat;
    try { stat = fs.statSync(file); } catch { loaded = null; return null; }
    if (!stat.isFile()) return null;
    // Dados recentes, na ordem de aplicação: API-Football (pode ser temporada antiga no
    // plano grátis; traz o id usado nos títulos) e depois GOAL API (temporada atual).
    const enrichFiles = [
      path.join(apiFootballDirectory(env.PASSE_API_FOOTBALL_DIR), 'enrichment.json'),
      path.join(goalApiDirectory(env.PASSE_GOAL_API_DIR), 'enrichment.json'),
    ];
    const idsFile = path.join(reepDirectory(env.PASSE_REEP_DIR), 'ids.json');
    enrichFiles.push(idsFile);
    const enrichStats = enrichFiles.map((f) => { try { return fs.statSync(f); } catch { return null; } });
    const signature = `${file}|${stat.mtimeMs}|${stat.ctimeMs}|${stat.size}|${stat.ino}|${enrichStats.map((x) => `${x?.mtimeMs ?? '-'}:${x?.size ?? '-'}`).join('|')}`;
    if (loaded?.signature === signature) return loaded;
    const reepIds = (() => { try { return JSON.parse(fs.readFileSync(idsFile, 'utf8')).players || {}; } catch { return {}; } })();
    const recentSets = enrichFiles.slice(0, 2).map((f, i) => {
      if (!enrichStats[i]) return {};
      try { return JSON.parse(fs.readFileSync(f, 'utf8')).players || {}; } catch { return {}; }
    });
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
      const entry = byId.get(p.id);
      for (const set of recentSets) if (set[p.id]) applyRecent(entry, set[p.id], nonnegative);
      const ids = reepIds[p.id];
      if (ids) {
        entry.links = { ...entry.links, ...profileLinks(entry.name, ids) };
        // ID oficial da API-Football: libera os títulos mesmo para quem não foi sincronizado.
        if (!Number.isInteger(entry.apiFootballId) && /^\d+$/.test(ids.apiFootball || '')) entry.apiFootballId = Number(ids.apiFootball);
      }
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
