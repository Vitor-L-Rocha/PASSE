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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(ROOT, process.env.PASSE_TMDATA_DIR || '.cache/tmdata');
export const INDEX_FILE = path.join(DATA_DIR, 'players.json');
const RAW_DIR = path.join(DATA_DIR, 'raw');
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
  let quoted = false;
  let afterQuote = false;
  for await (const chunk of stream) {
    const text = chunk.toString('utf8');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; }
        } else field += ch;
      } else if (ch === '"' && field === '' && !afterQuote) quoted = true;
      else if (ch === ',') { row.push(field); field = ''; afterQuote = false; }
      else if (ch === '\n') { row.push(field); yield row; row = []; field = ''; afterQuote = false; }
      else if (ch !== '\r') field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); yield row; }
}

async function* records(table) {
  const stream = fs.createReadStream(path.join(RAW_DIR, `${table}.csv.gz`)).pipe(zlib.createGunzip());
  let header = null;
  for await (const row of parseCsv(stream)) {
    if (!header) { header = row; continue; }
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = row[i] ?? '';
    yield obj;
  }
}

async function download(table, force) {
  const file = path.join(RAW_DIR, `${table}.csv.gz`);
  if (!force && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < MAX_AGE_MS) return;
  const url = new URL(`${table}.csv.gz`, BASE_URL);
  process.stdout.write(`  baixando ${table}… `);
  const res = await fetch(url, { headers: { 'User-Agent': 'PASSE-scouting (dataset sync)' } });
  if (!res.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${res.status}`);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, file);
  console.log(`${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const LOWER = new Set(['de', 'da', 'do', 'del', 'la', 'el', 'di']);
const titleCase = (slug) =>
  String(slug || '').split('-').filter(Boolean).map((w, i) => (i && LOWER.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');

function ageOn(dob, ref = new Date()) {
  const d = new Date(dob.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  let a = ref.getUTCFullYear() - d.getUTCFullYear();
  const m = ref.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && ref.getUTCDate() < d.getUTCDate())) a--;
  return a;
}

// Ligas de ano civil: rótulo = ano dos jogos. Demais: "2025/26".
function seasonLabel(season, leagueId, lastDate) {
  if (CALENDAR_YEAR_LEAGUES.has(leagueId)) return lastDate ? lastDate.slice(0, 4) : String(season + 1);
  return `${season}/${String((season + 1) % 100).padStart(2, '0')}`;
}

export async function build({ force = false, log = console.log } = {}) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  log('PASSE · sincronizando dados reais (transfermarkt-datasets, CC0)');
  for (const t of TABLES) await download(t, force);

  log('  processando competições e clubes…');
  const leagues = new Map();
  const competitionNames = new Map();
  for await (const c of records('competitions')) {
    competitionNames.set(c.competition_id, titleCase(c.name || c.competition_code));
    if (c.type === 'domestic_league' && COUNTRY_CODES[c.country_name]) {
      leagues.set(c.competition_id, { name: LEAGUE_NAMES[c.competition_id] || titleCase(c.name), country: COUNTRY_CODES[c.country_name] });
    }
  }
  const clubs = new Map();
  for await (const c of records('clubs')) clubs.set(c.club_id, { name: c.name, league: c.domestic_competition_id });

  log('  processando jogadores…');
  const all = [];
  let maxSeason = 0;
  for await (const p of records('players')) {
    const s = num(p.last_season);
    if (s) maxSeason = Math.max(maxSeason, s);
    all.push(p);
  }
  const players = new Map();
  for (const p of all) {
    const league = leagues.get(p.current_club_domestic_competition_id);
    const position = SUB_POSITIONS[p.sub_position] || (p.position === 'Goalkeeper' ? 'GK' : null);
    if (num(p.last_season) < maxSeason - 1 || !league || !position) continue;
    players.set(p.player_id, {
      id: `tmdata-${p.player_id}`,
      source: 'tmdata',
      name: p.name,
      age: p.date_of_birth ? ageOn(p.date_of_birth) : null,
      dateOfBirth: p.date_of_birth ? p.date_of_birth.slice(0, 10) : null,
      nationality: COUNTRY_CODES[p.country_of_citizenship] || p.country_of_citizenship || null,
      foot: FEET[p.foot] || null,
      heightCm: num(p.height_in_cm) || null,
      position,
      club: clubs.get(p.current_club_id)?.name || p.current_club_name || null,
      clubId: p.current_club_id,
      league: league.name,
      leagueId: p.current_club_domestic_competition_id,
      leagueCountry: league.country,
      marketValueEur: num(p.market_value_in_eur),
      contractUntil: p.contract_expiration_date ? p.contract_expiration_date.slice(0, 10) : null,
      photoUrl: /^https:\/\//.test(p.image_url) && !/default\.jpg/.test(p.image_url) ? p.image_url : null,
      links: p.url ? { transfermarkt: p.url } : {},
      _seasons: new Map(),
    });
  }
  log(`  ${players.size} jogadores em atividade em ${leagues.size} ligas`);

  log('  processando jogos…');
  const gameSeason = new Map();
  for await (const g of records('games')) {
    const s = num(g.season);
    if (s >= maxSeason - SEASONS_KEPT + 1) gameSeason.set(g.game_id, s);
  }

  log('  processando atuações (pode levar ~1 min)…');
  let n = 0;
  for await (const a of records('appearances')) {
    const p = players.get(a.player_id);
    if (!p) continue;
    const season = gameSeason.get(a.game_id);
    if (season === undefined) continue;
    const club = clubs.get(a.player_club_id);
    if (!club) continue; // seleções e clubes fora do dataset
    const key = `${season}|${a.player_club_id}`;
    let s = p._seasons.get(key);
    if (!s) {
      s = { season, lastDate: '', clubId: a.player_club_id, club: club.name, leagueId: club.league || null, appearances: 0, minutes: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, comps: new Map() };
      p._seasons.set(key, s);
    }
    if (a.date > s.lastDate) s.lastDate = a.date;
    s.appearances++;
    s.comps.set(a.competition_id, (s.comps.get(a.competition_id) || 0) + (num(a.minutes_played) || 0) + 1);
    s.minutes += num(a.minutes_played) || 0;
    s.goals += num(a.goals) || 0;
    s.assists += num(a.assists) || 0;
    s.yellowCards += num(a.yellow_cards) || 0;
    s.redCards += num(a.red_cards) || 0;
    n++;
  }
  log(`  ${n.toLocaleString('pt-BR')} atuações agregadas`);

  const out = [];
  for (const p of players.values()) {
    const seasons = [...p._seasons.values()]
      .sort((a, b) => b.season - a.season || b.minutes - a.minutes)
      .map((s) => ({
        season: seasonLabel(s.season, s.leagueId, s.lastDate),
        seasonId: s.season,
        club: s.club,
        // Competição em que o jogador mais atuou naquela temporada pelo clube.
        league: (() => { const top = [...s.comps.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]; return leagues.get(top)?.name || competitionNames.get(top) || null; })(),
        appearances: s.appearances,
        minutes: s.minutes,
        goals: s.goals,
        assists: s.assists,
        yellowCards: s.yellowCards,
        redCards: s.redCards,
        rating: null,
      }));
    // Taxas por 90 da temporada mais recente com minutagem suficiente (soma de clubes na temporada).
    const bySeason = new Map();
    for (const s of seasons) {
      const t = bySeason.get(s.seasonId) || { label: s.season, minutes: 0, goals: 0, assists: 0, appearances: 0 };
      t.minutes += s.minutes; t.goals += s.goals; t.assists += s.assists; t.appearances += s.appearances;
      bySeason.set(s.seasonId, t);
    }
    const ref = [...bySeason.entries()].sort((a, b) => b[0] - a[0]).find(([id, t]) => id >= maxSeason - 1 && t.minutes >= MIN_MINUTES_FOR_RATES); // só dados recentes
    const { _seasons, clubId, leagueId, ...rest } = p;
    out.push({
      ...rest,
      leagueId,
      season: ref ? ref[1].label : null,
      appearances: ref ? ref[1].appearances : null,
      minutes: ref ? ref[1].minutes : null,
      stats: ref ? { goals: (ref[1].goals * 90) / ref[1].minutes, assists: (ref[1].assists * 90) / ref[1].minutes } : {},
      seasons: seasons.slice(0, 8).map(({ seasonId, ...s }) => s),
      titles: null, // não disponível nesta fonte
      heatmap: null, // não disponível nesta fonte
      characteristics: null, // derivadas pelo núcleo a partir de stats
    });
  }

  const index = {
    generatedAt: new Date().toISOString(),
    source: {
      name: 'transfermarkt-datasets',
      url: 'https://github.com/dcaribou/transfermarkt-datasets',
      license: 'CC0 1.0',
      latestSeason: maxSeason,
    },
    leagues: [...leagues.entries()].map(([id, l]) => ({ id, ...l })),
    players: out,
  };
  const tmp = `${INDEX_FILE}.part`;
  fs.writeFileSync(tmp, JSON.stringify(index));
  fs.renameSync(tmp, INDEX_FILE);
  log(`  índice salvo: ${path.relative(ROOT, INDEX_FILE)} (${out.length} jogadores, ${(fs.statSync(INDEX_FILE).size / 1e6).toFixed(1)} MB)`);
  return index;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--if-missing') && fs.existsSync(INDEX_FILE)) process.exit(0);
  build({ force: args.has('--force') }).catch((err) => {
    console.error(`\nErro na sincronização: ${err.message}`);
    process.exit(1);
  });
}
