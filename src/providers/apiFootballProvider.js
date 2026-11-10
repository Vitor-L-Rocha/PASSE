import { allowedBaseUrl, createHttpClient, positiveNumber } from './httpClient.js';
import { footCode, matchesQuery, numberOrNull, per90, positionCode, readCatalog } from './normalization.js';
import { normalizeSeasons, safeUrl } from './dashboard.js';

// API-Sports v3, endpoint oficial /players, autenticação x-apisports-key.
export function createApiFootballProvider({ env = process.env, clientFactory = createHttpClient } = {}) {
  let client;
  let signature;
  function config() {
    const baseUrl = allowedBaseUrl(env.PASSE_API_FOOTBALL_URL || 'https://v3.football.api-sports.io/');
    const leagues = readCatalog(env.PASSE_API_FOOTBALL_LEAGUES);
    const season = env.PASSE_API_FOOTBALL_SEASON;
    let metadata;
    try { metadata = JSON.parse(env.PASSE_API_FOOTBALL_METADATA || '{}'); } catch { metadata = null; }
    const enabled = baseUrl && env.PASSE_API_FOOTBALL_KEY?.trim() && leagues.length && /^\d{4}$/.test(season || '') &&
      metadata && typeof metadata === 'object' && !Array.isArray(metadata);
    return { baseUrl, leagues, season, metadata, enabled: Boolean(enabled) };
  }
  function http(c) {
    const options = { namespace: 'api-football', baseUrl: c.baseUrl,
      headers: { 'x-apisports-key': env.PASSE_API_FOOTBALL_KEY },
      ttlMs: positiveNumber(env.PASSE_CACHE_TTL_MS, 3600000),
      intervalMs: positiveNumber(env.PASSE_API_FOOTBALL_INTERVAL_MS, 6500),
      timeoutMs: positiveNumber(env.PASSE_PROVIDER_TIMEOUT_MS, 10000) };
    const key = JSON.stringify(options);
    if (signature !== key) {
      client = clientFactory({ ...options, validate(data) {
        if (!data || (data.errors && Object.keys(data.errors).length) || !Array.isArray(data.response)) {
          throw new Error('api-football: API recusou a consulta ou retornou formato inválido');
        }
      } });
      signature = key;
    }
    return client;
  }
  async function request(c, params) {
    const data = await http(c).get('players', { season: c.season, ...params });
    if (!data || (data.errors && Object.keys(data.errors).length) || !Array.isArray(data.response)) {
      throw new Error('api-football: API recusou a consulta ou retornou formato inválido');
    }
    return data;
  }
  function normalize(row, league, c) {
    const player = row?.player;
    if (!player || !/^\d+$/.test(String(player.id)) || typeof player.name !== 'string') return null;
    const s = row.statistics?.find((s) => s && String(s.league?.id) === league.id && String(s.league?.season) === c.season);
    if (!s) return null;
    const extra = c.metadata[player.id] || {};
    // A API dá posições amplas (Defender/Midfielder/Attacker), não lateral/zagueiro etc.
    // Nunca inventa especialização nem valor de mercado ausente no serviço.
    const position = positionCode(extra.position) || positionCode(s.games?.position);
    if (!position) return null;
    const minutes = numberOrNull(s.games?.minutes);
    const stats = {
      goals: per90(s.goals?.total, minutes), assists: per90(s.goals?.assists, minutes),
      shots: per90(s.shots?.total, minutes), keyPasses: per90(s.passes?.key, minutes),
      dribbles: per90(s.dribbles?.success, minutes), tackles: per90(s.tackles?.total, minutes),
      interceptions: per90(s.tackles?.interceptions, minutes), saves: per90(s.goals?.saves, minutes),
    };
    const duels = numberOrNull(s.duels?.total);
    const won = numberOrNull(s.duels?.won);
    if (duels > 0 && won != null) stats.duelsWonPct = won * 100 / duels;
    const rating = numberOrNull(s.games?.rating);
    if (rating != null) stats.rating = rating;
    // passes.accuracy é uma média de passes certos, não um percentual.
    return { id: `api-football-${player.id}`, source: 'api-football', name: player.name,
      age: numberOrNull(player.age), nationality: player.nationality || null,
      foot: footCode(extra.foot), heightCm: numberOrNull(String(player.height || '').replace(/\s*cm$/, '')),
      position, club: s.team?.name || null, league: league.name, leagueCountry: league.country,
      marketValueEur: numberOrNull(extra.marketValueEur), contractUntil: extra.contractUntil || null,
      season: c.season, appearances: numberOrNull(s.games?.appearences ?? s.games?.appearances), minutes, stats, links: {},
      photoUrl: safeUrl(player.photo), characteristics: null, heatmap: null, titles: [],
      seasons: normalizeSeasons(row.statistics.filter(Boolean).map((entry) => ({
        season: entry.league?.season, club: entry.team?.name,
        league: entry.league?.name || c.leagues.find((l) => l.id === String(entry.league?.id))?.name,
        appearances: entry.games?.appearences ?? entry.games?.appearances, minutes: entry.games?.minutes,
        goals: entry.goals?.total, assists: entry.goals?.assists, rating: entry.games?.rating,
      }))) };
  }
  return {
    name: 'api-football', label: 'API-Football (API-Sports v3)',
    characteristics: ['finalizacao', 'drible', 'passesDecisivos', 'criacao', 'desarme', 'interceptacao', 'duelosNoChao', 'consistencia'],
    isEnabled: () => config().enabled,
    async searchPlayers(query = {}) {
      const c = config();
      if (!c.enabled) return [];
      const players = new Map();
      const maxPages = Math.max(1, Math.floor(positiveNumber(env.PASSE_API_FOOTBALL_MAX_PAGES, 10)));
      for (const league of c.leagues) {
        for (let page = 1; ; page++) {
          const data = await request(c, { league: league.id, page });
          for (const row of data.response) {
            const p = normalize(row, league, c);
            if (p && matchesQuery(p, query) && !players.has(p.id)) players.set(p.id, p);
          }
          const total = Number(data.paging?.total);
          if (!Number.isInteger(total) || total < 1) throw new Error('api-football: paginação inválida');
          if (page >= total) break;
          if (page >= maxPages) throw new Error('api-football: limite de páginas atingido; reduza o escopo ou ajuste MAX_PAGES');
        }
      }
      return [...players.values()];
    },
    async getPlayer(id) {
      const c = config();
      const match = String(id).match(/^api-football-(\d+)$/);
      if (!c.enabled || !match) return null;
      const data = await request(c, { id: match[1] });
      for (const league of c.leagues) for (const row of data.response) {
        const p = normalize(row, league, c);
        if (p?.id === id) return p;
      }
      return null;
    },
  };
}

export const apiFootballProvider = createApiFootballProvider();
