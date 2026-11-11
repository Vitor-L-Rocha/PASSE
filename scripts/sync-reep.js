#!/usr/bin/env node
// Liga cada jogador do índice aos seus IDs em outras plataformas usando o Reep
// (https://reep.football, registro aberto de identidades do futebol, licença CC0).
//
// A partir do ID do Transfermarkt (que o índice já tem), obtém os IDs de:
// API-Football (títulos e ligação confiável), SofaScore, FotMob, FBref, WhoScored e
// Understat. Os IDs viram LINKS na ficha: o scout abre o perfil na própria plataforma
// (onde estão, por exemplo, o mapa de calor e as características). Nada é coletado delas.
//
// Uso: npm run sync-reep      (baixa ~180 MB na primeira vez; reaproveita por 14 dias)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './sync-data.js';
import { tmdataDirectory, reepDirectory } from '../src/providers/tmdataPaths.js';

const BRIDGES_URL = process.env.PASSE_REEP_URL || 'https://reep.football/downloads/csv/bridges';
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const MIN_CONFIDENCE = 0.95;

// provider|namespace no Reep -> nome usado no PASSE
export const PROVIDERS = {
  'api_football|player': 'apiFootball',
  'sofascore|player': 'sofascore',
  'fotmob|person': 'fotmob',
  'fotmob|player': 'fotmob',
  'fbref|person': 'fbref',
  'fbref|player': 'fbref',
  'whoscored|player': 'whoscored',
  'understat|player': 'understat',
};
const TM_KEYS = new Set(['transfermarkt|spieler', 'transfermarkt|player']);

async function* rows(file) {
  let header = null;
  for await (const row of parseCsv(fs.createReadStream(file).pipe(zlib.createGunzip()))) {
    if (!header) { header = row; continue; }
    const o = {};
    for (let i = 0; i < header.length; i++) o[header[i]] = row[i] ?? '';
    yield o;
  }
}

async function download(file, { force = false, log }) {
  if (!force && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < MAX_AGE_MS) return;
  log('  baixando o registro do Reep (~180 MB)…');
  const res = await fetch(BRIDGES_URL, { headers: { 'User-Agent': 'PASSE-scouting (reep sync)' } });
  if (!res.ok) throw new Error(`Falha ao baixar o Reep: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(`${file}.part`));
  fs.renameSync(`${file}.part`, file);
}

// Duas passagens: (1) acha os reep_id dos jogadores do índice; (2) coleta os IDs deles nas outras plataformas.
export async function buildIds({ bridgesFile, tmIds, log = console.log }) {
  const reepByTm = new Map();
  for await (const r of rows(bridgesFile)) {
    if (r.entity_type !== 'player' || !TM_KEYS.has(`${r.provider}|${r.namespace}`)) continue;
    if (Number(r.confidence) < MIN_CONFIDENCE || !tmIds.has(r.external_id)) continue;
    reepByTm.set(r.external_id, r.reep_id);
  }
  const wanted = new Map([...reepByTm].map(([tm, reep]) => [reep, tm]));
  const out = {};
  for await (const r of rows(bridgesFile)) {
    const key = PROVIDERS[`${r.provider}|${r.namespace}`];
    if (!key || r.entity_type !== 'player' || Number(r.confidence) < MIN_CONFIDENCE) continue;
    const tm = wanted.get(r.reep_id);
    if (!tm) continue;
    (out[`tmdata-${tm}`] ||= {})[key] = r.external_id;
  }
  log(`  ${reepByTm.size} jogadores do índice encontrados no Reep; ${Object.keys(out).length} com IDs em outras plataformas.`);
  return out;
}

export async function syncReep({ force = false, log = console.log } = {}) {
  const dir = reepDirectory();
  const index = JSON.parse(fs.readFileSync(path.join(tmdataDirectory(), 'players.json'), 'utf8'));
  const tmIds = new Set(index.players.map((p) => String(p.id).replace(/^tmdata-/, '')));
  const bridgesFile = path.join(dir, 'bridges.csv.gz');
  log('Reep: ligando IDs entre plataformas');
  await download(bridgesFile, { force, log });
  const ids = await buildIds({ bridgesFile, tmIds, log });
  const counts = {};
  for (const v of Object.values(ids)) for (const k of Object.keys(v)) counts[k] = (counts[k] || 0) + 1;
  log(`  por plataforma: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  fs.writeFileSync(path.join(dir, 'ids.json'), JSON.stringify({ generatedAt: new Date().toISOString(), source: 'Reep (reep.football, CC0)', players: ids }));
  return ids;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  syncReep({ force: process.argv.includes('--force') }).catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
}
