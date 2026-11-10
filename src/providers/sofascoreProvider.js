import { getCharacteristic } from '../data/characteristics.js';
import { getCountry } from '../data/countries.js';
import { allowedBaseUrl, createHttpClient, positiveNumber } from './httpClient.js';
import { footCode, matchesQuery, numberOrNull, positionCode } from './normalization.js';
import { normalizeHeatmap, normalizeSeasons, normalizeTitles, safeUrl, textOrNull, seasonOrNull } from './dashboard.js';

// Convenção de rótulos do adaptador licenciado, não enumeração da API interna.
// Tipos numéricos só são interpretados com o mapa explícito do fornecedor.
const LABELS = {
  finishing: 'finalizacao', 'long shots': 'chutesDeLonge', heading: 'cabeceio',
  'aerial duels': 'duelosAereos', dribbling: 'drible', 'ball control': 'controleDeBola',
  speed: 'velocidade', passing: 'passe', 'key passes': 'passesDecisivos', creativity: 'criacao',
  crossing: 'cruzamentos', tackling: 'desarme', interceptions: 'interceptacao',
  positioning: 'posicionamento', 'ground duels': 'duelosNoChao', pressing: 'intensidade',
  'set pieces': 'bolaParada', consistency: 'consistencia', reflexes: 'reflexos',
  'coming off line': 'saidasDoGol', 'playing with feet': 'jogoComOsPes',
};

export function mapSofascoreCharacteristics(value, typeMap = {}) {
  if (!value || !Array.isArray(value.positive) || !Array.isArray(value.negative)) return null;
  function codes(items) {
    return [...new Set(items.map((item) => {
      const raw = typeof item === 'object' && item ? item.type : item;
      const key = String(raw ?? '');
      const mapped = Object.hasOwn(typeMap, key) ? typeMap[key] : LABELS[key.toLowerCase().trim()] || key;
      return getCharacteristic(mapped)?.code;
    }).filter(Boolean))];
  }
  const positive = codes(value.positive);
  const negative = codes(value.negative);
  // Descartar contradições evita escolher arbitrariamente forte/fraco.
  const conflicts = new Set(positive.filter((code) => negative.includes(code)));
  const result = { positive: positive.filter((code) => !conflicts.has(code)),
    negative: negative.filter((code) => !conflicts.has(code)), source: 'fonte' };
  return result.positive.length || result.negative.length || (!value.positive.length && !value.negative.length) ? result : null;
}

// Contrato do feed está em src/providers/SOFASCORE_FEED.md. Nenhuma chamada é
// feita à API pública protegida; redirects também são recusados pelo cliente.
export function createSofascoreProvider({ env = process.env, clientFactory = createHttpClient } = {}) {
  let client;
  let signature;
  function config() {
    const baseUrl = allowedBaseUrl(env.PASSE_SOFASCORE_URL);
    let typeMap;
    let playerIds;
    try {
      typeMap = JSON.parse(env.PASSE_SOFASCORE_TYPE_MAP || '{}');
      playerIds = JSON.parse(env.PASSE_SOFASCORE_PLAYER_IDS || '{}');
    } catch { return { enabled: false }; }
    const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const valid = object(typeMap) && Object.values(typeMap).every((code) => getCharacteristic(code)) &&
      object(playerIds) && Object.values(playerIds).every((id) => /^\d+$/.test(String(id)));
    return { baseUrl, typeMap, playerIds,
      enabled: Boolean(baseUrl && env.PASSE_SOFASCORE_AUTHORIZED === 'true' && valid) };
  }
  function http(c) {
    const options = { namespace: 'sofascore', baseUrl: c.baseUrl,
      headers: env.PASSE_SOFASCORE_TOKEN ? { Authorization: `Bearer ${env.PASSE_SOFASCORE_TOKEN}` } : {},
      intervalMs: positiveNumber(env.PASSE_SOFASCORE_INTERVAL_MS, 1500),
      timeoutMs: positiveNumber(env.PASSE_PROVIDER_TIMEOUT_MS, 10000),
      ttlMs: positiveNumber(env.PASSE_CACHE_TTL_MS, 3600000) };
    const key = JSON.stringify(options);
    if (signature !== key) { client = clientFactory(options); signature = key; }
    return client;
  }
  function details(row, c) {
    const link = safeUrl(row.links?.sofascore);
    return { photoUrl: safeUrl(row.photoUrl),
      characteristics: mapSofascoreCharacteristics(row.characteristics, c.typeMap),
      heatmap: normalizeHeatmap(row.heatmap), seasons: normalizeSeasons(row.seasons),
      titles: normalizeTitles(row.titles), links: link ? { sofascore: link } : {} };
  }
  function normalize(row, c) {
    if (!row || !/^\d+$/.test(String(row.id)) || !textOrNull(row.name)) return null;
    const position = positionCode(row.position);
    const country = getCountry(row.leagueCountry);
    if (!position || !country) return null;
    return { id: `sofascore-${row.id}`, source: 'sofascore', name: row.name,
      age: numberOrNull(row.age), nationality: textOrNull(row.nationality), foot: footCode(row.foot),
      heightCm: numberOrNull(row.heightCm), position, club: textOrNull(row.club), league: textOrNull(row.league),
      leagueCountry: country.code, marketValueEur: numberOrNull(row.marketValueEur),
      contractUntil: textOrNull(row.contractUntil), season: seasonOrNull(row.season),
      appearances: numberOrNull(row.appearances), minutes: numberOrNull(row.minutes),
      // stats: taxas /90 e percentuais conforme contrato PASSE, já convertidos pelo feed.
      stats: row.stats && typeof row.stats === 'object' && !Array.isArray(row.stats)
        ? Object.fromEntries(Object.entries(row.stats).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) : {},
      ...details(row, c) };
  }
  async function rawPlayer(id, c) {
    const data = await http(c).get(`players/${id}`);
    if (!data || !Object.hasOwn(data, 'player')) throw new Error('sofascore: formato de detalhe inválido');
    if (data.player === null) return null;
    if (!data.player || String(data.player.id) !== String(id)) throw new Error('sofascore: identidade divergente no feed');
    return data.player;
  }
  return {
    name: 'sofascore', label: 'SofaScore (feed autorizado)',
    isEnabled: () => config().enabled,
    async searchPlayers(query = {}) {
      const c = config();
      if (!c.enabled) return [];
      const result = new Map();
      const seen = new Set();
      let cursor;
      const maxPages = Math.max(1, Math.floor(positiveNumber(env.PASSE_SOFASCORE_MAX_PAGES, 10)));
      for (let page = 1; ; page++) {
        const data = await http(c).get('players', { position: query.position, maxBudgetEur: query.maxBudgetEur, cursor });
        if (!Array.isArray(data?.players)) throw new Error('sofascore: formato de busca inválido');
        for (const row of data.players) {
          const player = normalize(row, c);
          if (player && matchesQuery(player, query)) result.set(player.id, player);
        }
        if (data.nextCursor == null) break;
        if (typeof data.nextCursor !== 'string' || !data.nextCursor || seen.has(data.nextCursor) || page >= maxPages) {
          throw new Error('sofascore: paginação inválida ou limite atingido');
        }
        cursor = data.nextCursor;
        seen.add(cursor);
      }
      return [...result.values()];
    },
    async getPlayer(id) {
      const c = config();
      const match = String(id).match(/^sofascore-(\d+)$/);
      if (!c.enabled || !match) return null;
      const row = await rawPlayer(match[1], c);
      return row ? normalize(row, c) : null;
    },
    async enrichPlayer(player, { sofascoreId } = {}) {
      const c = config();
      if (!c.enabled || !player) return player;
      const id = sofascoreId ?? (Object.hasOwn(c.playerIds, player.id) ? c.playerIds[player.id] : null);
      if (!/^\d+$/.test(String(id))) return player;
      // Enriquecimento opcional: falha/403 preserva integralmente o jogador original.
      try {
        const row = await rawPlayer(id, c);
        if (!row) return player;
        const extra = details(row, c);
        return { ...player,
          photoUrl: player.photoUrl || extra.photoUrl,
          characteristics: extra.characteristics || player.characteristics || null,
          heatmap: extra.heatmap || player.heatmap || null,
          // Não mistura totais de fontes diferentes para a mesma temporada.
          seasons: player.seasons?.length ? player.seasons : extra.seasons,
          titles: player.titles?.length ? player.titles : extra.titles,
          links: { ...(player.links || {}), ...extra.links } };
      } catch { return player; }
    },
  };
}

export const sofascoreProvider = createSofascoreProvider();
export const enrichPlayerWithSofascore = (player, options) => sofascoreProvider.enrichPlayer(player, options);
