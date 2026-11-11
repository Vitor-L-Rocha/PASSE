#!/usr/bin/env node
// Atualiza os jogadores do PASSE com dados RECENTES da API-Football (API-Sports v3,
// acesso oficial com chave). Complementa o índice do transfermarkt-datasets, que
// continua sendo a base (valor de mercado, contrato, foto).
//
// O que traz, por liga, na temporada ATUAL: clube atual, jogos, minutos, gols,
// assistências, finalizações, passes decisivos, dribles, desarmes, interceptações,
// duelos, defesas (goleiros) e a nota média da própria API-Football.
//
// Cota: o plano grátis tem 100 consultas/dia. O script lê o uso pela rota /status,
// gasta no máximo PASSE_API_FOOTBALL_DAILY_BUDGET (padrão 80) e continua de onde
// parou na próxima execução. ~20 jogadores por consulta.
//
// Uso:
//   npm run sync-apifootball                 sincroniza as ligas configuradas
//   npm run sync-apifootball -- --check      só verifica chave, plano e acesso à temporada atual
//   npm run sync-apifootball -- --rematch    refaz o casamento com o índice sem consultar a API
//
// Ligas: PASSE_API_FOOTBALL_SYNC_LEAGUES=BRA1,ARG1 (códigos do índice; padrão BRA1).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmdataDirectory, apiFootballDirectory } from '../src/providers/tmdataPaths.js';
import { createClient, ApiError } from '../src/providers/apiFootballClient.js';

export { createClient, ApiError };

// Código da liga no índice (transfermarkt-datasets) -> id da liga na API-Football.
// Conferido em tempo de execução pela rota /leagues (nome e país).
export const LEAGUE_IDS = {
  BRA1: 71, ARG1: 128, MLS1: 253, MEX1: 262, JAP1: 98, RSK1: 292, SA1: 307, AUS1: 188,
  GB1: 39, ES1: 140, IT1: 135, L1: 78, FR1: 61, PO1: 94, NL1: 88, BE1: 144, TR1: 203,
  SC1: 179, A1: 218, C1: 207, DK1: 119, GR1: 197, NO1: 103, SE1: 113, PL1: 106, RO1: 283,
  RU1: 235, UKR1: 333, SER1: 286, TS1: 345, KR1: 210,
};
const CALENDAR_YEAR = new Set(['BRA1', 'ARG1', 'MLS1', 'JAP1', 'RSK1', 'NO1', 'SE1']);
const STALE_MS = 3 * 24 * 3600 * 1000; // liga é atualizada de novo após 3 dias
const RESERVE = 10; // consultas reservadas para títulos abertos na ficha

export const apiDirectory = () => apiFootballDirectory();

// ---------- conversão de estatísticas para o formato do PASSE ----------
const n = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export function aggregateStats(entries) {
  const sum = (pick) => {
    let total = null;
    for (const e of entries) {
      const v = n(pick(e));
      if (v !== null) total = (total ?? 0) + v;
    }
    return total;
  };
  const minutes = sum((e) => e.games?.minutes) || 0;
  const appearances = sum((e) => e.games?.appearences ?? e.games?.appearances);
  // Nota média ponderada pelos minutos.
  let rw = 0;
  let rs = 0;
  for (const e of entries) {
    const r = n(e.games?.rating);
    const m = n(e.games?.minutes) || 0;
    if (r !== null && m > 0) { rs += r * m; rw += m; }
  }
  const raw = {
    goals: sum((e) => e.goals?.total), assists: sum((e) => e.goals?.assists), shots: sum((e) => e.shots?.total),
    keyPasses: sum((e) => e.passes?.key), dribbles: sum((e) => e.dribbles?.success), tackles: sum((e) => e.tackles?.total),
    interceptions: sum((e) => e.tackles?.interceptions), duelsTotal: sum((e) => e.duels?.total), duelsWon: sum((e) => e.duels?.won),
    saves: sum((e) => e.goals?.saves), conceded: sum((e) => e.goals?.conceded),
  };
  const per90 = (v) => (v === null || minutes <= 0 ? undefined : (v * 90) / minutes);
  const stats = {
    goals: per90(raw.goals), assists: per90(raw.assists), shots: per90(raw.shots), keyPasses: per90(raw.keyPasses),
    dribbles: per90(raw.dribbles), tackles: per90(raw.tackles), interceptions: per90(raw.interceptions),
    duelsWonPct: raw.duelsTotal > 0 && raw.duelsWon !== null ? (raw.duelsWon / raw.duelsTotal) * 100 : undefined,
    rating: rw > 0 ? rs / rw : undefined,
  };
  if (raw.saves !== null && raw.conceded !== null && raw.saves + raw.conceded > 0) {
    stats.saves = per90(raw.saves);
    stats.savePct = (raw.saves / (raw.saves + raw.conceded)) * 100;
  }
  for (const k of Object.keys(stats)) if (stats[k] === undefined || !Number.isFinite(stats[k])) delete stats[k];
  return { minutes, appearances, goals: raw.goals, assists: raw.assists, rating: stats.rating ?? null, stats };
}

// ---------- casamento com o índice (data de nascimento + nome) ----------
export const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 1);

export function buildMatcher(tmPlayers) {
  const byDob = new Map();
  for (const p of tmPlayers) {
    if (!p.dateOfBirth) continue;
    const list = byDob.get(p.dateOfBirth) || [];
    list.push(p);
    byDob.set(p.dateOfBirth, list);
  }
  return function match(apiPlayer) {
    const dob = apiPlayer.birth?.date;
    const candidates = dob ? byDob.get(dob) : null;
    if (!candidates?.length) return null;
    const apiTokens = new Set([...normName(apiPlayer.name), ...normName(apiPlayer.firstname), ...normName(apiPlayer.lastname)]);
    let best = null;
    let bestScore = 0;
    let tie = false;
    for (const c of candidates) {
      const score = normName(c.name).filter((t) => apiTokens.has(t)).length;
      if (score > bestScore) { best = c; bestScore = score; tie = false; } else if (score === bestScore && score > 0) tie = true;
    }
    return bestScore > 0 && !tie ? best : null;
  };
}

function seasonLabel(tmLeague, year) {
  return CALENDAR_YEAR.has(tmLeague) ? String(year) : `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}

// ---------- estado e arquivos ----------
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, JSON.stringify(data));
  fs.renameSync(`${file}.part`, file);
}

export function rebuildEnrichment({ log = console.log } = {}) {
  const dir = apiDirectory();
  const indexFile = path.join(tmdataDirectory(), 'players.json');
  const index = readJson(indexFile, null);
  if (!index?.players) throw new Error('Índice de dados reais não encontrado; rode npm run sync-data antes.');
  const match = buildMatcher(index.players);
  const leagueNames = new Map((index.leagues || []).map((l) => [l.id, l]));
  const state = readJson(path.join(dir, 'state.json'), { leagues: {} });
  const out = {};
  let total = 0;
  let matched = 0;
  for (const [tmLeague, st] of Object.entries(state.leagues)) {
    if (!st.season) continue;
    const data = readJson(path.join(dir, 'leagues', `${tmLeague}-${st.season}.json`), null);
    if (!data?.players) continue;
    for (const ap of data.players) {
      total++;
      const tm = match(ap);
      if (!tm) continue;
      matched++;
      const prev = out[tm.id];
      if (prev && prev.minutes >= ap.minutes) continue; // mesmo jogador em duas ligas: fica a de mais minutos
      out[tm.id] = {
        apiId: ap.id, tmLeague, leagueName: leagueNames.get(tmLeague)?.name || data.leagueName, leagueCountry: leagueNames.get(tmLeague)?.country || null,
        season: seasonLabel(tmLeague, st.season), current: !st.currentSeason || st.season >= st.currentSeason, team: ap.team, appearances: ap.appearances, minutes: ap.minutes,
        goals: ap.goals, assists: ap.assists, rating: ap.rating, stats: ap.stats, photo: ap.photo, fetchedAt: data.fetchedAt,
      };
    }
  }
  writeJson(path.join(dir, 'enrichment.json'), { generatedAt: new Date().toISOString(), source: 'API-Football (API-Sports v3)', players: out });
  log(`  casamento: ${matched} de ${total} jogadores da API-Football ligados ao índice (${Object.keys(out).length} atualizados)`);
  return out;
}

export async function sync({ client = createClient(), leagues = (process.env.PASSE_API_FOOTBALL_SYNC_LEAGUES || 'BRA1').split(',').map((s) => s.trim()).filter(Boolean),
  budget = Number(process.env.PASSE_API_FOOTBALL_DAILY_BUDGET) || 80, checkOnly = false, log = console.log, now = () => Date.now() } = {}) {
  const dir = apiDirectory();
  const stateFile = path.join(dir, 'state.json');
  const state = readJson(stateFile, { leagues: {} });

  const status = (await client.get('status')).response || {};
  const used = n(status.requests?.current) ?? 0;
  const limit = n(status.requests?.limit_day) ?? 100;
  log(`API-Football: plano ${status.subscription?.plan || '?'}, ${used}/${limit} consultas usadas hoje.`);
  let remaining = Math.max(0, Math.min(budget, limit - used - RESERVE));

  for (const tmLeague of leagues) {
    const apiLeague = LEAGUE_IDS[tmLeague];
    if (!apiLeague) { log(`  ${tmLeague}: liga sem correspondência na API-Football, ignorada.`); continue; }
    const st = (state.leagues[tmLeague] ||= {});
    if (!st.season || !st.checkedAt || now() - st.checkedAt > STALE_MS) {
      if (remaining < 1) break;
      const info = (await client.get('leagues', { id: apiLeague, current: 'true' })).response?.[0];
      remaining--;
      const current = info?.seasons?.find((s) => s.current) || info?.seasons?.[0];
      if (!current) { log(`  ${tmLeague}: a API-Football não informou temporada atual.`); continue; }
      // Planos limitados (ex.: grátis) só liberam temporadas antigas: usa a mais recente permitida.
      const target = st.allowedMax ? Math.min(current.year, st.allowedMax) : current.year;
      if (st.season !== target) Object.assign(st, { season: target, page: 0, totalPages: null, completedAt: null });
      Object.assign(st, { currentSeason: current.year, checkedAt: now(), name: info.league?.name, country: info.country?.name, coveragePlayers: current.coverage?.players ?? null });
      log(`  ${tmLeague}: ${st.name} (${st.country}), temporada atual ${current.year}${st.season !== current.year ? `; o plano libera até ${st.season}, que será usada` : ''}${st.coveragePlayers === false ? ' (sem estatísticas de jogadores)' : ''}`);
    }
    if (checkOnly) {
      // Uma página para provar acesso à temporada atual com este plano.
      try {
        const page = await client.get('players', { league: apiLeague, season: st.season, page: 1 });
        log(`  ${tmLeague}: acesso à temporada ${st.season} OK (${page.paging?.total ?? '?'} páginas de jogadores).`);
      } catch (e) {
        log(`  ${tmLeague}: SEM acesso à temporada ${st.season}: ${e.message}`);
      }
      continue;
    }
    const leagueFile = path.join(dir, 'leagues', `${tmLeague}-${st.season}.json`);
    if (st.completedAt && now() - st.completedAt < STALE_MS) {
      log(`  ${tmLeague}: já atualizada (${new Date(st.completedAt).toLocaleDateString('pt-BR')}).`);
      continue;
    }
    // Progresso: modo "league" pagina a liga inteira; modo "team" pagina time por time
    // (planos que limitam o número de páginas, como o grátis, só funcionam assim).
    st.mode ||= 'league';
    st.cursor ||= { team: 0, page: 0, total: null };
    const data = readJson(leagueFile, { leagueName: st.name, players: [] });
    const byId = new Map(data.players.map((p) => [p.id, p]));
    const finished = () => (st.mode === 'league' ? st.cursor.total !== null && st.cursor.page >= st.cursor.total : st.teams && st.cursor.team >= st.teams.length);
    while (remaining > 0 && !finished()) {
      let json;
      try {
        if (st.mode === 'team' && !st.teams) {
          const teams = await client.get('teams', { league: apiLeague, season: st.season });
          remaining--;
          st.teams = (teams.response || []).map((t) => t.team?.id).filter(Number.isInteger);
          writeJson(stateFile, state);
          continue;
        }
        const params = st.mode === 'league'
          ? { league: apiLeague, season: st.season, page: st.cursor.page + 1 }
          : { team: st.teams[st.cursor.team], season: st.season, page: st.cursor.page + 1 };
        json = await client.get('players', params);
      } catch (e) {
        remaining--;
        const allowed = /access to this season.*?(\d{4})\D+(\d{4})/i.exec(e.message);
        const pageCap = /maximum value of (\d+) for the page/i.exec(e.message);
        if (allowed && !st.allowedMax) {
          // Ex.: "Free plans do not have access to this season, try from 2022 to 2024."
          st.allowedMax = Number(allowed[2]);
          log(`  ${tmLeague}: o plano não libera ${st.season}; usando ${st.allowedMax}, a mais recente permitida (estatísticas ficam rotuladas com o ano).`);
          Object.assign(st, { season: st.allowedMax, cursor: null, teams: null, completedAt: null });
        } else if (pageCap && st.mode === 'league') {
          // Ex.: "Free plans are limited to a maximum value of 3 for the Page parameter"
          st.pageCap = Number(pageCap[1]);
          log(`  ${tmLeague}: o plano limita a ${st.pageCap} páginas por consulta; buscando time por time.`);
          Object.assign(st, { mode: 'team', cursor: null, teams: null });
        } else throw e;
        writeJson(stateFile, state);
        // Recomeça no novo modo (a rota /status não conta na cota).
        return sync({ client, leagues, budget: remaining, checkOnly, log, now });
      }
      remaining--;
      for (const row of json.response || []) {
        const entries = (row.statistics || []).filter((x) => x.league?.id === apiLeague);
        if (!entries.length) continue;
        const agg = aggregateStats(entries);
        const team = entries.slice().sort((a, b) => (n(b.games?.minutes) || 0) - (n(a.games?.minutes) || 0))[0]?.team?.name || null;
        const prev = byId.get(row.player.id);
        if (prev && prev.minutes > agg.minutes) continue; // jogador que trocou de time na temporada: fica o registro maior
        byId.set(row.player.id, {
          id: row.player.id, name: row.player.name, firstname: row.player.firstname, lastname: row.player.lastname,
          birth: { date: row.player.birth?.date || null }, photo: row.player.photo || null, team, ...agg,
        });
      }
      st.cursor.page++;
      st.cursor.total = Math.min(n(json.paging?.total) || st.cursor.page, st.pageCap || Infinity);
      if (st.mode === 'team' && st.cursor.page >= st.cursor.total) st.cursor = { team: st.cursor.team + 1, page: 0, total: null };
      data.players = [...byId.values()];
      data.fetchedAt = new Date(now()).toISOString();
      writeJson(leagueFile, data);
      writeJson(stateFile, state);
    }
    const progress = st.mode === 'team' ? `${Math.min(st.cursor.team, st.teams?.length ?? 0)}/${st.teams?.length ?? '?'} times` : `${st.cursor.page}/${st.cursor.total ?? '?'} páginas`;
    if (finished()) Object.assign(st, { completedAt: now(), cursor: null, teams: st.mode === 'team' ? null : st.teams });
    log(`  ${tmLeague}: ${progress} (${byId.size} jogadores)${st.completedAt ? '' : ', continua na próxima execução'}`);
    writeJson(stateFile, state);
    if (remaining < 1) { log('  Cota do dia reservada para hoje esgotada; rode de novo amanhã para continuar.'); break; }
  }
  writeJson(stateFile, state);
  if (!checkOnly) rebuildEnrichment({ log });
  return state;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = new Set(process.argv.slice(2));
  const run = args.has('--rematch') ? async () => rebuildEnrichment() : () => sync({ checkOnly: args.has('--check') });
  run().catch((err) => {
    console.error(`\n${err instanceof ApiError ? '' : 'Erro: '}${err.message}`);
    process.exit(1);
  });
}
