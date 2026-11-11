#!/usr/bin/env node
// Complementos do conjunto "football-datasets" (github.com/salimt/football-datasets),
// publicado pelo autor no Kaggle sob licença CC0 (domínio público):
//  - HISTÓRICO DE LESÕES (atualizado até set/2026);
//  - temporadas por competição de todas as ligas, inclusive o Brasileirão (jogos,
//    minutos, gols, assistências), até set/2025.
// Os IDs são os do Transfermarkt, os mesmos do índice: a ligação é exata.
//
// Uso: npm run sync-salimt     (baixa ~170 MB na primeira vez; reaproveita por 14 dias)

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './sync-data.js';
import { tmdataDirectory, salimtDirectory } from '../src/providers/tmdataPaths.js';

const BASE = process.env.PASSE_SALIMT_URL || 'https://media.githubusercontent.com/media/salimt/football-datasets/main/datalake/transfermarkt/';
const FILES = {
  performances: 'player_performances/player_performances.csv',
  injuries: 'player_injuries/player_injuries_updated_20260929.csv',
};
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const FIRST_SEASON = 2022; // temporadas a partir de 2022 (ou 2022/23)
const INJURY_SINCE = '2022-07-01';

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

// "24/25" -> "2024/25"; "2025" -> "2025"; retorna também o ano inicial para filtrar.
export function seasonOf(raw) {
  const s = String(raw || '').trim();
  let m = /^(\d{2})\/(\d{2})$/.exec(s);
  if (m) { const y = 2000 + Number(m[1]); return { label: `${y}/${m[2]}`, year: y }; }
  m = /^(\d{4})$/.exec(s);
  if (m) return { label: s, year: Number(s) };
  return null;
}

async function* records(file) {
  let header = null;
  for await (const row of parseCsv(fs.createReadStream(file))) {
    if (!header) { header = row; continue; }
    const o = {};
    for (let i = 0; i < header.length; i++) o[header[i]] = row[i] ?? '';
    yield o;
  }
}

async function download(name, rel, dir, { force, log }) {
  const file = path.join(dir, `${name}.csv`);
  if (!force && fs.existsSync(file) && fs.statSync(file).size > 1000 && Date.now() - fs.statSync(file).mtimeMs < MAX_AGE_MS) return file;
  log(`  baixando ${name}…`);
  const res = await fetch(new URL(rel, BASE), { headers: { 'User-Agent': 'PASSE-scouting (dataset sync)' } });
  if (!res.ok) throw new Error(`Falha ao baixar ${name}: HTTP ${res.status}`);
  fs.mkdirSync(dir, { recursive: true });
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(`${file}.part`));
  fs.renameSync(`${file}.part`, file);
  return file;
}

export async function buildExtras({ performancesFile, injuriesFile, tmIds, log = console.log }) {
  const out = {};
  const entry = (id) => (out[`tmdata-${id}`] ||= { seasons: [], injuries: [] });
  let seasons = 0;
  for await (const r of records(performancesFile)) {
    if (!tmIds.has(r.player_id)) continue;
    const s = seasonOf(r.season_name);
    if (!s || s.year < FIRST_SEASON) continue;
    const apps = num(r.nb_on_pitch);
    if (!apps) continue;
    entry(r.player_id).seasons.push({
      season: s.label, year: s.year, competitionId: r.competition_id || null, league: r.competition_name || null,
      club: r.team_name || null, appearances: apps, minutes: num(r.minutes_played), goals: num(r.goals), assists: num(r.assists),
    });
    seasons++;
  }
  let injuries = 0;
  for await (const r of records(injuriesFile)) {
    if (!tmIds.has(r.player_id) || !r.from_date || r.from_date < INJURY_SINCE) continue;
    entry(r.player_id).injuries.push({
      reason: r.injury_reason || null, from: r.from_date || null, to: r.end_date || null,
      daysMissed: num(r.days_missed), gamesMissed: num(r.games_missed),
    });
    injuries++;
  }
  for (const e of Object.values(out)) {
    e.seasons.sort((a, b) => b.year - a.year || (b.minutes || 0) - (a.minutes || 0));
    e.injuries.sort((a, b) => String(b.from).localeCompare(String(a.from)));
  }
  log(`  ${seasons} temporadas por competição e ${injuries} lesões (desde jul/2022) para ${Object.keys(out).length} jogadores do índice.`);
  return out;
}

export async function syncSalimt({ force = false, log = console.log } = {}) {
  const dir = salimtDirectory();
  const index = JSON.parse(fs.readFileSync(path.join(tmdataDirectory(), 'players.json'), 'utf8'));
  const tmIds = new Set(index.players.map((p) => String(p.id).replace(/^tmdata-/, '')));
  log('football-datasets (CC0): lesões e temporadas por competição');
  const performancesFile = await download('performances', FILES.performances, dir, { force, log });
  const injuriesFile = await download('injuries', FILES.injuries, dir, { force, log });
  const players = await buildExtras({ performancesFile, injuriesFile, tmIds, log });
  fs.writeFileSync(path.join(dir, 'extras.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'football-datasets (salimt, CC0 no Kaggle)',
    injuriesUntil: '2026-09-28', performancesUntil: '2025-09',
    players,
  }));
  return players;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  syncSalimt({ force: process.argv.includes('--force') }).catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
}
