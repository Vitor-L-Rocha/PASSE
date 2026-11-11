#!/usr/bin/env node
// Estatísticas da TEMPORADA ATUAL pela GOAL API (goal-api.com, plano grátis com chave,
// 1.000 consultas/dia). Complementa o índice do transfermarkt-datasets.
//
// Cuidados, verificados com a chave real (nov/2026):
//  - a fonte não informa MINUTOS: as taxas são calculadas POR JOGO;
//  - parte dos elencos vem sem números ou com números "derivados" pela própria fonte;
//    só entram jogadores com estatística original ("source"), nota e
//    PASSE_GOAL_API_MIN_GAMES jogos ou mais (padrão 8).
//
// Uso: npm run sync-goalapi            (ligas em PASSE_GOAL_API_LEAGUES, padrão BRA1)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmdataDirectory, goalApiDirectory } from '../src/providers/tmdataPaths.js';
import { buildMatcher } from './sync-apifootball.js';

// Código da liga no índice -> [país, nome da liga na GOAL API].
export const GOAL_LEAGUES = {
  BRA1: ['Brazil', 'Serie A'], ARG1: ['Argentina', 'Liga Profesional'], MLS1: ['USA', 'MLS'], MEX1: ['Mexico', 'Liga MX'],
  GB1: ['England', 'Premier League'], ES1: ['Spain', 'La Liga'], IT1: ['Italy', 'Serie A'], L1: ['Germany', 'Bundesliga'],
  FR1: ['France', 'Ligue 1'], PO1: ['Portugal', 'Primeira Liga'], NL1: ['Netherlands', 'Eredivisie'],
};
const CALENDAR_YEAR = new Set(['BRA1', 'ARG1', 'MLS1', 'JAP1', 'RSK1', 'NO1', 'SE1']);
const YOUTH = /women|feminin|u-?\d{2}|youth|junior|reserve|\bb$|ii$/i;

const n = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, JSON.stringify(data));
  fs.renameSync(`${file}.part`, file);
}

export function createGoalClient({ key = process.env.PASSE_GOAL_API_KEY, baseUrl = process.env.PASSE_GOAL_API_URL || 'https://goal-api.com/api/v1/', fetchImpl = fetch } = {}) {
  if (!key) throw new Error('Chave da GOAL API ausente. Coloque PASSE_GOAL_API_KEY=... no arquivo .env.');
  let calls = 0;
  let remaining = null;
  return {
    get calls() { return calls; },
    get remaining() { return remaining; },
    async get(route, params = {}) {
      const url = new URL(route.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      calls++;
      const left = res.headers?.get?.('x-ratelimit-remaining');
      if (left !== null && left !== undefined && left !== '') remaining = Number(left);
      if (res.status === 401 || res.status === 403) throw new Error('Chave recusada pela GOAL API (verifique PASSE_GOAL_API_KEY).');
      if (res.status === 429) throw new Error('Cota da GOAL API esgotada por hoje. Rode de novo amanhã.');
      if (!res.ok) throw new Error(`GOAL API respondeu HTTP ${res.status}.`);
      const json = await res.json();
      if (json?.success === false) throw new Error(json.error?.message || json.message || 'GOAL API recusou a consulta.');
      return json;
    },
  };
}

// Converte o registro da GOAL API para o formato de estatísticas do PASSE (taxas POR JOGO).
export function goalStats(p) {
  const games = n(p.matchPlayed);
  if (!games) return null;
  const pg = (v) => (n(v) === null ? undefined : n(v) / games);
  const passes = n(p.passes);
  const accurate = n(p.passesAccuracy); // a fonte informa passes CERTOS, não percentual
  const duels = n(p.duelsTotal);
  const saves = n(p.saves);
  const conceded = n(p.goalsConceded);
  const stats = {
    goals: pg(p.goals ?? 0), assists: pg(p.assists ?? 0), shots: pg(p.shotsTotal), keyPasses: pg(p.keyPasses),
    dribbles: pg(p.dribbleSucc), tackles: pg(p.tackles), interceptions: pg(p.interceptions),
    passAccuracy: passes > 0 && accurate !== null ? (accurate / passes) * 100 : undefined,
    duelsWonPct: duels > 0 && n(p.duelsWon) !== null ? (n(p.duelsWon) / duels) * 100 : undefined,
    rating: n(p.rating) ?? undefined,
  };
  if (saves !== null && conceded !== null && saves + conceded > 0) {
    stats.saves = saves / games;
    stats.savePct = (saves / (saves + conceded)) * 100;
  }
  for (const k of Object.keys(stats)) if (stats[k] === undefined || !Number.isFinite(stats[k])) delete stats[k];
  return stats;
}

export function usable(p, minGames) {
  return p.statsSource === 'source' && n(p.rating) !== null && n(p.matchPlayed) >= minGames &&
    (n(p.dribbleSucc) !== null || n(p.tackles) !== null || n(p.keyPasses) !== null);
}

async function resolveLeague(client, tmLeague) {
  const [country, name] = GOAL_LEAGUES[tmLeague] || [];
  if (!country) return null;
  const json = await client.get('leagues', { search: name, limit: 50 });
  const candidates = (json.data || []).filter((l) => l.countryName === country && !YOUTH.test(l.name));
  return candidates.find((l) => l.name === name) || candidates.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0] || null;
}

export async function syncGoal({ client = createGoalClient(), leagues = (process.env.PASSE_GOAL_API_LEAGUES || 'BRA1').split(',').map((s) => s.trim()).filter(Boolean),
  minGames = Number(process.env.PASSE_GOAL_API_MIN_GAMES) || 8, log = console.log, now = () => new Date() } = {}) {
  const dir = goalApiDirectory();
  const index = readJson(path.join(tmdataDirectory(), 'players.json'), null);
  if (!index?.players) throw new Error('Índice de dados reais não encontrado; rode npm run sync-data antes.');
  const match = buildMatcher(index.players);
  const leagueInfo = new Map((index.leagues || []).map((l) => [l.id, l]));
  const out = readJson(path.join(dir, 'enrichment.json'), { players: {} }).players || {};
  log('GOAL API: sincronizando temporada atual');
  for (const tmLeague of leagues) {
    const league = await resolveLeague(client, tmLeague);
    if (!league) { log(`  ${tmLeague}: liga não encontrada na GOAL API, ignorada.`); continue; }
    const seasonYear = String(league.season || '').slice(0, 4);
    const season = CALENDAR_YEAR.has(tmLeague) ? seasonYear : `${seasonYear}/${String((Number(seasonYear) + 1) % 100).padStart(2, '0')}`;
    const teams = (await client.get('teams', { leagueId: league.id, limit: 100 })).data || [];
    let seen = 0;
    let kept = 0;
    let linked = 0;
    // Remove registros antigos desta liga antes de regravar.
    for (const [id, r] of Object.entries(out)) if (r.tmLeague === tmLeague) delete out[id];
    for (const team of teams) {
      for (let offset = 0; ; offset += 50) {
        const page = await client.get('players', { teamId: team.id, limit: 50, offset });
        for (const p of page.data || []) {
          seen++;
          if (!usable(p, minGames)) continue;
          kept++;
          const tm = match({ name: p.name, birth: { date: p.birthdate ? String(p.birthdate).slice(0, 10) : null } });
          if (!tm) continue;
          linked++;
          const games = n(p.matchPlayed);
          out[tm.id] = {
            source: 'GOAL API', current: true, perGame: true, tmLeague, goalId: p.id,
            leagueName: leagueInfo.get(tmLeague)?.name || league.name, leagueCountry: leagueInfo.get(tmLeague)?.country || null,
            season, team: p.team?.name || team.name, appearances: games, minutes: null,
            goals: n(p.goals) ?? 0, assists: n(p.assists) ?? 0, rating: n(p.rating), stats: goalStats(p),
            photo: p.image || null, fetchedAt: now().toISOString(),
          };
        }
        if (!page.meta?.hasMore) break;
      }
    }
    log(`  ${tmLeague}: ${league.name} ${league.season}, ${teams.length} times, ${seen} jogadores; ${kept} com estatística completa (${minGames}+ jogos); ${linked} ligados ao índice.`);
  }
  writeJson(path.join(dir, 'enrichment.json'), { generatedAt: now().toISOString(), source: 'GOAL API', players: out });
  log(`  consultas usadas: ${client.calls}${client.remaining !== null ? `; restam ${client.remaining} hoje` : ''}.`);
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  syncGoal().catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
}
