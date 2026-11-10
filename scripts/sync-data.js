#!/usr/bin/env node
// Baixa e prepara os dados REAIS do PASSE a partir do projeto aberto
// transfermarkt-datasets (https://github.com/dcaribou/transfermarkt-datasets),
// publicado sob licença CC0 1.0 (domínio público).
//
// Uso:
//   node scripts/sync-data.js              baixa (se necessário) e reconstrói o índice
//   node scripts/sync-data.js --if-missing só faz algo se o índice ainda não existir
//   node scripts/sync-data.js --force      baixa tudo de novo
//
// Saída: .cache/tmdata/players.json (fora do Git). Só entram jogadores em atividade
// em clubes de ligas nacionais cobertas, com estatísticas das últimas temporadas.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { getCountry } from '../src/data/countries.js';
import { safeUrl } from '../src/providers/dashboard.js';
import { PROJECT_ROOT, tmdataDirectory } from '../src/providers/tmdataPaths.js';

const ROOT = PROJECT_ROOT;
export const DATA_DIR = tmdataDirectory();
export const INDEX_FILE = path.join(DATA_DIR, 'players.json');
const BASE_URL = process.env.PASSE_TMDATA_URL || 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/';
const TABLES = ['competitions', 'clubs', 'players', 'games', 'appearances'];
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const SEASONS_KEPT = 5;
const MIN_MINUTES_FOR_RATES = 450;

// Nome do país (inglês, como no dataset) -> código usado em src/data/countries.js.
export const COUNTRY_CODES = {
  Austria: 'AT', Argentina: 'AR', Australia: 'AU', Belgium: 'BE', Brazil: 'BR', Switzerland: 'CH', Denmark: 'DK',
  Spain: 'ES', France: 'FR', England: 'GB', Greece: 'GR', Italy: 'IT', Japan: 'JP', Croatia: 'HR', Germany: 'DE',
  Mexico: 'MX', 'United States': 'US', Netherlands: 'NL', Norway: 'NO', Poland: 'PL', Portugal: 'PT', Romania: 'RO',
  'Korea, South': 'KR', Russia: 'RU', 'Saudi Arabia': 'SA', Scotland: 'SCT', Sweden: 'SE', Serbia: 'RS',
  Türkiye: 'TR', Turkey: 'TR', 'Czech Republic': 'CZ', Ukraine: 'UA', Uruguay: 'UY', Colombia: 'CO', Chile: 'CL',
  Paraguay: 'PY', Ecuador: 'EC', Peru: 'PE', Venezuela: 'VE', Bolivia: 'BO', Canada: 'CA', 'Costa Rica': 'CR',
  Egypt: 'EG', Morocco: 'MA', 'South Africa': 'ZA', Nigeria: 'NG', Qatar: 'QA', 'United Arab Emirates': 'AE',
  China: 'CN', "China PR": 'CN',
};

// Ligas com temporada no ano civil (Transfermarkt usa o ano anterior como id da temporada).
const CALENDAR_YEAR_LEAGUES = new Set(['BRA1', 'ARG1', 'MLS1', 'JAP1', 'RSK1', 'NO1', 'SE1']);

// Nomes de exibição das ligas (o dataset traz slugs).
const LEAGUE_NAMES = {
  A1: 'Bundesliga (Áustria)', ARG1: 'Liga Profesional', AUS1: 'A-League', BE1: 'Pro League', BRA1: 'Brasileirão Série A',
  C1: 'Super League (Suíça)', DK1: 'Superliga (Dinamarca)', ES1: 'LaLiga', FR1: 'Ligue 1', GB1: 'Premier League',
  GR1: 'Super League (Grécia)', IT1: 'Serie A', JAP1: 'J1 League', KR1: 'HNL', L1: 'Bundesliga', MEX1: 'Liga MX',
  MLS1: 'MLS', NL1: 'Eredivisie', NO1: 'Eliteserien', PL1: 'Ekstraklasa', PO1: 'Liga Portugal', RO1: 'Superliga (Romênia)',
  RSK1: 'K League 1', RU1: 'Premier Liga (Rússia)', SA1: 'Saudi Pro League', SC1: 'Premiership', SE1: 'Allsvenskan',
  SER1: 'SuperLiga (Sérvia)', TR1: 'Süper Lig', TS1: 'Chance Liga', UKR1: 'Premier Liga (Ucrânia)',
};

const SUB_POSITIONS = {
  Goalkeeper: 'GK', 'Centre-Back': 'CB', 'Left-Back': 'LB', 'Right-Back': 'RB', 'Defensive Midfield': 'DM',
  'Central Midfield': 'CM', 'Attacking Midfield': 'AM', 'Left Midfield': 'LW', 'Right Midfield': 'RW',
  'Left Winger': 'LW', 'Right Winger': 'RW', 'Centre-Forward': 'ST', 'Second Striker': 'ST',
};
const FEET = { right: 'direito', left: 'esquerdo', both: 'ambidestro' };

// ---------- CSV em streaming (aspas, vírgulas e quebras de linha dentro de campos) ----------
export async function* parseCsv(stream) {
  let field = '';
  let row = [];
  let state = 'start';
  let first = true;
  let skipLF = false;
  const decoder = new StringDecoder('utf8');
  async function* chunks() {
    for await (const chunk of stream) yield typeof chunk === 'string' ? chunk : decoder.write(chunk);
    yield decoder.end();
  }
  for await (const text of chunks()) {
    for (const ch of text) {
      if (first) { first = false; if (ch === '\uFEFF') continue; }
      if (skipLF) { skipLF = false; if (ch === '\n') continue; }
      if (state === 'quoted') {
        if (ch === '"') state = 'afterQuote';
        else field += ch;
        continue;
      }
      if (state === 'afterQuote' && ch === '"') { field += '"'; state = 'quoted'; continue; }
      if (ch === ',') { row.push(field); field = ''; state = 'start'; }
      else if (ch === '\n' || ch === '\r') {
        row.push(field); yield row; row = []; field = ''; state = 'start'; skipLF = ch === '\r';
      } else if (ch === '"' && state === 'start') state = 'quoted';
      else {
        if (state === 'afterQuote' || ch === '"') throw new Error('CSV inválido: aspas fora de campo delimitado');
        field += ch; state = 'unquoted';
      }
    }
  }
  if (state === 'quoted') throw new Error('CSV inválido: campo entre aspas não terminado');
  if (state !== 'start' || field !== '' || row.length) { row.push(field); yield row; }
}

async function* records(table, rawDir) {
  const input = fs.createReadStream(path.join(rawDir, `${table}.csv.gz`));
  const stream = input.pipe(zlib.createGunzip());
  input.on('error', (error) => stream.destroy(error));
  let header = null;
  try {
    for await (const row of parseCsv(stream)) {
      if (row.length === 1 && row[0] === '') continue;
      if (!header) {
        header = row;
        const required = { competitions: ['competition_id', 'type', 'country_name'],
          clubs: ['club_id', 'name', 'domestic_competition_id'],
          players: ['player_id', 'name', 'last_season', 'current_club_id', 'current_club_domestic_competition_id'],
          games: ['game_id', 'season', 'competition_id', 'date'],
          appearances: ['game_id', 'player_id', 'player_club_id', 'minutes_played', 'goals', 'assists'] }[table];
        if (new Set(header).size !== header.length || !required.every((key) => header.includes(key))) {
          throw new Error(`CSV ${table}: cabeçalho inválido`);
        }
        continue;
      }
      if (row.length !== header.length) throw new Error(`CSV ${table}: número de campos inválido`);
      yield Object.fromEntries(header.map((key, i) => [key, row[i]]));
    }
    if (!header) throw new Error(`CSV ${table}: arquivo vazio`);
  } finally {
    input.destroy(); stream.destroy();
  }
}

async function download(table, force, { rawDir, baseUrl, fetchImpl }) {
  const file = path.join(rawDir, `${table}.csv.gz`);
  if (!force && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < MAX_AGE_MS) return;
  const url = new URL(`${table}.csv.gz`, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  process.stdout.write(`  baixando ${table}… `);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'PASSE-scouting (dataset sync)' } });
  if (!res.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${res.status}`);
  const tmp = `${file}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    // Verifica integridade gzip antes de substituir uma cópia boa.
    await pipeline(fs.createReadStream(tmp), zlib.createGunzip(), async (source) => { for await (const _ of source) { /* drain */ } });
    fs.renameSync(tmp, file);
  } catch (error) { fs.rmSync(tmp, { force: true }); throw error; }
  console.log(`${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}

const num = (v) => (v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));
const LOWER = new Set(['de', 'da', 'do', 'del', 'la', 'el', 'di']);
const titleCase = (slug) =>
  String(slug || '').split('-').filter(Boolean).map((w, i) => (i && LOWER.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');

function ageOn(dob, ref = new Date()) {
  const d = new Date(dob.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dob.slice(0, 10)) return null;
  let a = ref.getUTCFullYear() - d.getUTCFullYear();
  const m = ref.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && ref.getUTCDate() < d.getUTCDate())) a--;
  return a >= 0 && a <= 100 ? a : null;
}

// Ligas de ano civil: rótulo = ano dos jogos. Demais: "2025/26".
export function seasonLabel(season, leagueId) {
  // Convenção do dataset: ano civil = id + 1, inclusive partidas adiadas.
  if (CALENDAR_YEAR_LEAGUES.has(leagueId)) return String(season + 1);
  return `${season}/${String((season + 1) % 100).padStart(2, '0')}`;
}

export async function build({ force = false, log = console.log, dataDir = tmdataDirectory(),
  baseUrl = BASE_URL, fetchImpl = globalThis.fetch, skipDownload = false, now = new Date() } = {}) {
  const rawDir = path.join(dataDir, 'raw');
  const indexFile = path.join(dataDir, 'players.json');
  fs.mkdirSync(rawDir, { recursive: true });
  log('PASSE · sincronizando dados reais (transfermarkt-datasets, CC0)');
  if (!skipDownload) for (const t of TABLES) await download(t, force, { rawDir, baseUrl, fetchImpl });

  log('  processando competições e clubes…');
  const leagues = new Map();
  const competitionNames = new Map();
  const competitions = new Map();
  for await (const c of records('competitions', rawDir)) {
    competitions.set(c.competition_id, c);
    competitionNames.set(c.competition_id, titleCase(c.name || c.competition_code));
    if (c.type === 'domestic_league' && getCountry(COUNTRY_CODES[c.country_name])) {
      leagues.set(c.competition_id, { name: LEAGUE_NAMES[c.competition_id] || titleCase(c.name), country: COUNTRY_CODES[c.country_name] });
    }
  }
  const clubs = new Map();
  for await (const c of records('clubs', rawDir)) clubs.set(c.club_id, { name: c.name, league: c.domestic_competition_id });

  log('  processando jogadores…');
  const all = [];
  let maxSeason = 0;
  for await (const p of records('players', rawDir)) {
    const s = num(p.last_season);
    if (s) maxSeason = Math.max(maxSeason, s);
    all.push(p);
  }
  const players = new Map();
  for (const p of all) {
    const leagueId = clubs.get(p.current_club_id)?.league || p.current_club_domestic_competition_id;
    const league = leagues.get(leagueId);
    const position = SUB_POSITIONS[p.sub_position] || (p.position === 'Goalkeeper' ? 'GK' : null);
    if (!/^\d+$/.test(p.player_id) || !p.name?.trim() || num(p.last_season) == null || num(p.last_season) < maxSeason - 1 || !league || !position) continue;
    players.set(p.player_id, {
      id: `tmdata-${p.player_id}`,
      source: 'tmdata',
      name: p.name,
      age: p.date_of_birth ? ageOn(p.date_of_birth, now) : null,
      dateOfBirth: p.date_of_birth ? p.date_of_birth.slice(0, 10) : null,
      nationality: COUNTRY_CODES[p.country_of_citizenship] || p.country_of_citizenship || null,
      foot: FEET[p.foot] || null,
      heightCm: num(p.height_in_cm) || null,
      position,
      club: clubs.get(p.current_club_id)?.name || p.current_club_name || null,
      clubId: p.current_club_id,
      league: league.name,
      leagueId,
      leagueCountry: league.country,
      marketValueEur: num(p.market_value_in_eur),
      contractUntil: p.contract_expiration_date ? p.contract_expiration_date.slice(0, 10) : null,
      photoUrl: !/default\.jpg/.test(p.image_url || '') ? safeUrl(p.image_url) : null,
      links: safeUrl(p.url) ? { transfermarkt: safeUrl(p.url) } : {},
      _seasons: new Map(),
    });
  }
  log(`  ${players.size} jogadores em atividade em ${leagues.size} ligas`);

  log('  processando jogos…');
  const games = new Map();
  let lastGameDate = null;
  for await (const g of records('games', rawDir)) {
    const s = num(g.season);
    const competition = competitions.get(g.competition_id);
    if (competition?.type === 'national_team_competition') continue;
    if (s != null && s >= maxSeason - SEASONS_KEPT + 1 && s <= maxSeason && competition) {
      games.set(g.game_id, { season: s, competitionId: g.competition_id, date: g.date });
      if (g.date && (!lastGameDate || g.date > lastGameDate)) lastGameDate = g.date;
    }
  }

  log('  processando atuações (pode levar ~1 min)…');
  let n = 0;
  let lastAppearanceDate = null;
  const seenAppearances = new Set();
  for await (const a of records('appearances', rawDir)) {
    const p = players.get(a.player_id);
    if (!p) continue;
    const game = games.get(a.game_id);
    if (!game || (a.competition_id && a.competition_id !== game.competitionId)) continue;
    const { season, competitionId } = game;
    const club = clubs.get(a.player_club_id);
    if (!club) continue; // seleções e clubes fora do dataset
    const appearanceKey = `${a.game_id}|${a.player_id}`;
    if (seenAppearances.has(appearanceKey)) continue;
    seenAppearances.add(appearanceKey);
    const key = `${season}|${a.player_club_id}|${competitionId}`;
    let s = p._seasons.get(key);
    if (!s) {
      s = { season, clubId: a.player_club_id, club: club.name, competitionId,
        appearances: 0, minutes: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0 };
      p._seasons.set(key, s);
    }
    if (game.date && (!lastAppearanceDate || game.date > lastAppearanceDate)) lastAppearanceDate = game.date;
    s.appearances++;
    for (const [key, column] of Object.entries({ minutes: 'minutes_played', goals: 'goals', assists: 'assists', yellowCards: 'yellow_cards', redCards: 'red_cards' })) {
      const value = num(a[column]);
      s[key] = s[key] == null || value == null ? null : s[key] + value;
    }
    n++;
  }
  log(`  ${n.toLocaleString('pt-BR')} atuações agregadas`);

  const out = [];
  for (const p of players.values()) {
    const seasons = [...p._seasons.values()]
      .sort((a, b) => b.season - a.season || b.minutes - a.minutes)
      .map((s) => ({
        season: seasonLabel(s.season, competitions.get(s.competitionId)?.domestic_league_code || s.competitionId),
        seasonId: s.season,
        club: s.club,
        competitionId: s.competitionId,
        league: leagues.get(s.competitionId)?.name || competitionNames.get(s.competitionId) || null,
        appearances: s.appearances,
        minutes: s.minutes,
        goals: s.goals,
        assists: s.assists,
        yellowCards: s.yellowCards,
        redCards: s.redCards,
        rating: null,
      }));
    // Taxas da mesma temporada rotulada: nunca soma "2025" e "2025/26" só
    // porque os IDs brutos coincidem. Times/competições do mesmo período se somam.
    const bySeason = new Map();
    for (const s of seasons) {
      const t = bySeason.get(s.season) || { label: s.season, seasonId: s.seasonId, minutes: 0, goals: 0, assists: 0, appearances: 0 };
      for (const key of ['minutes', 'goals', 'assists', 'appearances']) {
        t[key] = t[key] == null || s[key] == null ? null : t[key] + s[key];
      }
      bySeason.set(s.season, t);
    }
    const ref = [...bySeason.values()].sort((a, b) => b.seasonId - a.seasonId || b.label.localeCompare(a.label))
      .find((t) => t.seasonId >= maxSeason - 1 && t.minutes >= MIN_MINUTES_FOR_RATES);
    const { _seasons, clubId, leagueId, ...rest } = p;
    out.push({
      ...rest,
      leagueId,
      season: ref ? ref.label : null,
      appearances: ref ? ref.appearances : null,
      minutes: ref ? ref.minutes : null,
      stats: ref ? Object.fromEntries(['goals', 'assists'].filter((key) => ref[key] != null)
        .map((key) => [key, (ref[key] * 90) / ref.minutes])) : {},
      seasons: seasons.map(({ seasonId, ...s }) => s),
      titles: [], // não disponível nesta fonte
      heatmap: null, // não disponível nesta fonte
      characteristics: null, // derivadas pelo núcleo a partir de stats
    });
  }

  const index = {
    schemaVersion: 2,
    generatedAt: now.toISOString(),
    source: {
      name: 'transfermarkt-datasets',
      url: 'https://github.com/dcaribou/transfermarkt-datasets',
      license: 'CC0 1.0',
      latestSeason: maxSeason,
      lastGameDate,
      lastAppearanceDate,
    },
    leagues: [...leagues.entries()].map(([id, l]) => ({ id, ...l })),
    players: out,
  };
  if (!out.length) throw new Error('Nenhum jogador válido: índice anterior preservado');
  const tmp = `${indexFile}.part`;
  fs.writeFileSync(tmp, JSON.stringify(index));
  fs.renameSync(tmp, indexFile);
  log(`  índice salvo: ${path.relative(ROOT, indexFile)} (${out.length} jogadores, ${(fs.statSync(indexFile).size / 1e6).toFixed(1)} MB)`);
  return index;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--if-missing')) {
    try {
      const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      if (index.schemaVersion === 2 && Array.isArray(index.players) && index.players.length) process.exit(0);
    } catch { /* ausente ou inválido: reconstruir */ }
  }
  build({ force: args.has('--force') }).catch((err) => {
    console.error(`\nErro na sincronização: ${err.message}`);
    process.exit(1);
  });
}
