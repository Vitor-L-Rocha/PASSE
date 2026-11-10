import { allowedBaseUrl, createHttpClient, positiveNumber } from './httpClient.js';
import { footCode, matchesQuery, numberOrNull, per90, positionCode, readCatalog } from './normalization.js';
import { normalizeSeasons, normalizeTitles, safeUrl } from './dashboard.js';

// Compatível com felipeall/transfermarkt-api v4 (JSON camelCase).
// A instância deve ter autorização para fornecer esses dados ao PASSE.
export function createTransfermarktProvider({ env = process.env, clientFactory = createHttpClient } = {}) {
  let client;
  let signature;
  function config() {
    const baseUrl = allowedBaseUrl(env.PASSE_TRANSFERMARKT_URL);
    const clubs = readCatalog(env.PASSE_TRANSFERMARKT_CLUBS).map((c) => ({ ...c, competitionId: String(c.competitionId || '') }));
    const season = env.PASSE_TRANSFERMARKT_SEASON;
    const enabled = env.PASSE_TRANSFERMARKT_AUTHORIZED === 'true' && baseUrl && clubs.length &&
      /^\d{4}$/.test(season || '') && clubs.every((c) => typeof c.league === 'string' && c.league.trim() && /^[A-Za-z0-9]+$/.test(c.competitionId || ''));
    return { baseUrl, clubs, season, enabled: Boolean(enabled) };
  }
  function http(c) {
    const options = { namespace: 'transfermarkt', baseUrl: c.baseUrl,
      headers: env.PASSE_TRANSFERMARKT_TOKEN ? { Authorization: `Bearer ${env.PASSE_TRANSFERMARKT_TOKEN}` } : {},
      ttlMs: positiveNumber(env.PASSE_CACHE_TTL_MS, 3600000),
      intervalMs: positiveNumber(env.PASSE_TRANSFERMARKT_INTERVAL_MS, 1500),
      timeoutMs: positiveNumber(env.PASSE_PROVIDER_TIMEOUT_MS, 10000) };
    const key = JSON.stringify(options);
    if (signature !== key) { client = clientFactory(options); signature = key; }
    return client;
  }
  function normalize(row, club, season) {
    if (!/^\d+$/.test(String(row.id)) || typeof row.name !== 'string') return null;
    const position = positionCode(row.position);
    if (!position) return null;
    return { id: `transfermarkt-${row.id}`, source: 'transfermarkt', name: row.name,
      age: numberOrNull(row.age), nationality: Array.isArray(row.nationality) ? row.nationality.join(', ') : null,
      foot: footCode(row.foot), heightCm: numberOrNull(row.height), position,
      club: club.name, league: club.league, leagueCountry: club.country,
      marketValueEur: numberOrNull(row.marketValue), contractUntil: row.contract || null,
      season, appearances: null, minutes: null, stats: {},
      photoUrl: safeUrl(row.imageUrl), characteristics: null, seasons: [], titles: [], heatmap: null,
      links: { transfermarkt: `https://www.transfermarkt.com/-/profil/spieler/${row.id}` } };
  }
  function withStats(player, club, c, data) {
    if (!Array.isArray(data?.stats)) throw new Error('transfermarkt: formato de estatísticas inválido');
    const seasons = normalizeSeasons(data.stats.filter(Boolean).map((s) => ({
      season: s.seasonId,
      club: c.clubs.find((candidate) => candidate.id === String(s.clubId))?.name || null,
      league: s.competitionName || (String(s.competitionId) === club.competitionId ? club.league : null),
      appearances: s.appearances, minutes: s.minutesPlayed, goals: s.goals, assists: s.assists, rating: null,
    })));
    player = { ...player, seasons };
    const rows = data.stats.filter((s) => s && String(s.clubId) === club.id &&
      String(s.competitionId) === club.competitionId && String(s.seasonId) === c.season);
    if (!rows.length) return player;
    const sum = (key) => rows.every((s) => numberOrNull(s[key]) != null)
      ? rows.reduce((total, s) => total + numberOrNull(s[key]), 0) : null;
    const minutes = sum('minutesPlayed');
    return { ...player, appearances: sum('appearances'), minutes,
      stats: { goals: per90(sum('goals'), minutes), assists: per90(sum('assists'), minutes) } };
  }
  async function addStats(player, club, c) {
    const data = await http(c).get(`players/${player.id.slice('transfermarkt-'.length)}/stats`);
    return withStats(player, club, c, data);
  }
  async function dashboard(player, club, c) {
    const id = player.id.slice('transfermarkt-'.length);
    const [stats, achievements, profile] = await Promise.allSettled([
      http(c).get(`players/${id}/stats`), http(c).get(`players/${id}/achievements`),
      player.photoUrl ? Promise.resolve(null) : http(c).get(`players/${id}/profile`),
    ]);
    if (stats.status === 'fulfilled') {
      try { player = withStats(player, club, c, stats.value); } catch { /* detalhe opcional indisponível */ }
    }
    if (achievements.status === 'fulfilled' && Array.isArray(achievements.value?.achievements)) {
      player = { ...player, titles: normalizeTitles(achievements.value.achievements.flatMap((a) => {
        if (!a || typeof a.title !== 'string') return [];
        if (!Array.isArray(a.details) || !a.details.length) return [{ name: a.title }];
        return a.details.filter(Boolean).map((d) => ({ name: a.title,
          season: d.season?.name || d.season?.id, club: d.club?.name }));
      })) };
    }
    if (profile.status === 'fulfilled' && !player.photoUrl) player = { ...player, photoUrl: safeUrl(profile.value?.imageUrl) };
    return player;
  }
  async function squad(club, c, query, wantedId) {
    const data = await http(c).get(`clubs/${club.id}/players`, { season_id: c.season });
    if (!Array.isArray(data?.players)) throw new Error('transfermarkt: formato de elenco inválido');
    const players = data.players.filter((row) => row && (!wantedId || `transfermarkt-${row.id}` === wantedId))
      .map((row) => normalize(row, club, c.season)).filter((p) => p && matchesQuery(p, query));
    if (wantedId || env.PASSE_TRANSFERMARKT_INCLUDE_STATS !== 'true') return players;
    const result = [];
    for (const player of players) result.push(await addStats(player, club, c));
    return result;
  }
  return {
    name: 'transfermarkt', label: 'Transfermarkt (instância autorizada)',
    isEnabled: () => config().enabled,
    async searchPlayers(query = {}) {
      const c = config();
      if (!c.enabled) return [];
      const players = new Map();
      for (const club of c.clubs) for (const player of await squad(club, c, query)) players.set(player.id, player);
      return [...players.values()];
    },
    async getPlayer(id) {
      const c = config();
      if (!/^transfermarkt-\d+$/.test(String(id))) return null;
      // Reusa os mesmos dados/escopo da busca, inclusive após reiniciar o processo.
      if (!c.enabled) return null;
      for (const club of c.clubs) {
        const [player] = await squad(club, c, {}, id);
        if (player) return dashboard(player, club, c);
      }
      return null;
    },
  };
}

export const transfermarktProvider = createTransfermarktProvider();
