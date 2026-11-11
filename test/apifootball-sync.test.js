// Ponta a ponta com uma API-Football SIMULADA (nada sai da máquina):
// sincroniza uma liga, casa com o índice por nascimento + nome, e confere que
// ranking e ficha passam a usar clube atual, estatísticas recentes e títulos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { sync, createClient, aggregateStats, buildMatcher } from '../scripts/sync-apifootball.js';
import { createApp } from '../src/server.js';
import { normalizeTrophies } from '../src/providers/apiFootballTitles.js';

const ENV = ['PASSE_PROVIDERS', 'PASSE_TMDATA_DIR', 'PASSE_API_FOOTBALL_DIR', 'PASSE_API_FOOTBALL_KEY', 'PASSE_API_FOOTBALL_URL'];
const saved = {};
let api, app, base, dir, calls = [];

const listen = (a) => new Promise((resolve) => { const s = a.listen(0, '127.0.0.1', () => resolve(s)); });
const stat = (o) => ({ league: { id: 71, name: 'Serie A' }, team: { name: o.team }, games: { appearences: o.apps, minutes: o.min, rating: o.rating },
  goals: { total: o.g, assists: o.a, saves: null, conceded: null }, shots: { total: o.sh }, passes: { key: o.kp },
  dribbles: { success: o.dr }, tackles: { total: o.tk, interceptions: o.int }, duels: { total: o.dt, won: o.dw } });

before(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passe-af-'));
  fs.mkdirSync(path.join(dir, 'tm'));
  fs.writeFileSync(path.join(dir, 'tm', 'players.json'), JSON.stringify({
    leagues: [{ id: 'BRA1', name: 'Brasileirão Série A', country: 'BR' }],
    players: [
      { id: 'tmdata-10', source: 'tmdata', name: 'João Driblador', dateOfBirth: '2003-04-05', position: 'LW', leagueCountry: 'BR',
        league: 'Brasileirão Série A', club: 'Clube Antigo', marketValueEur: 3_000_000, stats: {}, seasons: [] },
      { id: 'tmdata-11', source: 'tmdata', name: 'Pedro Parado', dateOfBirth: '2001-01-01', position: 'LW', leagueCountry: 'BR',
        league: 'Brasileirão Série A', club: 'Outro', marketValueEur: 2_000_000, stats: {}, seasons: [] },
    ],
  }));
  const fake = express();
  fake.use((req, res, next) => { calls.push(req.path); if (req.get('x-apisports-key') !== 'chave-teste') return res.status(401).end(); next(); });
  fake.get('/status', (_q, res) => res.json({ errors: [], response: { subscription: { plan: 'Free' }, requests: { current: 3, limit_day: 100 } } }));
  fake.get('/leagues', (_q, res) => res.json({ errors: [], response: [{ league: { id: 71, name: 'Serie A' }, country: { name: 'Brazil' }, seasons: [{ year: 2026, current: true, coverage: { players: true } }] }] }));
  fake.get('/players', (req, res) => res.json({ errors: [], paging: { current: 1, total: 1 }, response: [
    { player: { id: 501, name: 'João D.', firstname: 'João', lastname: 'Driblador', birth: { date: '2003-04-05' }, photo: 'https://media.example/501.png' },
      statistics: [stat({ team: 'Clube Novo', apps: 30, min: 2400, rating: '7.4', g: 6, a: 8, sh: 40, kp: 60, dr: 90, tk: 20, int: 8, dt: 300, dw: 170 })] },
    { player: { id: 502, name: 'Desconhecido', firstname: 'X', lastname: 'Y', birth: { date: '1990-01-01' } },
      statistics: [stat({ team: 'Z', apps: 5, min: 300, rating: '6.5', g: 0, a: 0, sh: 1, kp: 1, dr: 1, tk: 1, int: 1, dt: 10, dw: 4 })] },
  ] }));
  fake.get('/trophies', (_q, res) => res.json({ errors: [], response: [
    { league: 'Copa do Brasil', country: 'Brazil', season: '2025', place: 'Winner' },
    { league: 'Serie A', country: 'Brazil', season: '2024', place: '2nd Place' },
  ] }));
  api = await listen(fake);
  Object.assign(process.env, {
    PASSE_PROVIDERS: 'tmdata', PASSE_TMDATA_DIR: path.join(dir, 'tm'), PASSE_API_FOOTBALL_DIR: path.join(dir, 'af'),
    PASSE_API_FOOTBALL_KEY: 'chave-teste', PASSE_API_FOOTBALL_URL: `http://127.0.0.1:${api.address().port}/`,
  });
  app = await listen(createApp());
  base = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
  for (const k of ENV) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  await Promise.all([api, app].map((s) => new Promise((r) => s.close(r))));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('estatísticas da API-Football viram taxas por 90 no formato do PASSE', () => {
  const agg = aggregateStats([stat({ team: 'A', apps: 10, min: 900, rating: '7.0', g: 5, a: 2, sh: 20, kp: 10, dr: 30, tk: 15, int: 6, dt: 100, dw: 60 })]);
  assert.equal(agg.minutes, 900);
  assert.equal(agg.stats.goals, 0.5);
  assert.equal(agg.stats.dribbles, 3);
  assert.equal(agg.stats.duelsWonPct, 60);
  assert.equal(agg.stats.rating, 7);
});

test('casamento exige mesma data de nascimento e nome compatível', () => {
  const match = buildMatcher([{ id: 'a', name: 'João Silva', dateOfBirth: '2000-01-01' }, { id: 'b', name: 'Carlos Souza', dateOfBirth: '2000-01-01' }]);
  assert.equal(match({ name: 'J. Silva', lastname: 'Silva', birth: { date: '2000-01-01' } }).id, 'a');
  assert.equal(match({ name: 'Silva', birth: { date: '1999-01-01' } }), null);
  assert.equal(match({ name: 'Fulano', birth: { date: '2000-01-01' } }), null);
});

test('chave ausente gera erro claro', () => {
  assert.throws(() => createClient({ key: '' }), /PASSE_API_FOOTBALL_KEY/);
});

test('sincroniza, respeita a cota e atualiza ranking, ficha e títulos', async () => {
  const logs = [];
  await sync({ client: createClient(), leagues: ['BRA1'], budget: 80, log: (m) => logs.push(m) });
  assert.ok(logs.some((l) => /plano Free/.test(l)));
  assert.ok(logs.some((l) => /1 de 2 jogadores/.test(l)), logs.join('\n'));

  const meta = await fetch(`${base}/api/meta`).then((r) => r.json());
  assert.equal(meta.characteristics.find((c) => c.code === 'drible').available, true, 'drible liberado pelos dados recentes');

  const d = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ country: 'BR', position: 'LW', maxBudgetEur: 5_000_000, selectedCharacteristics: ['drible'] }) }).then((r) => r.json());
  const list = d.markets.interno;
  assert.equal(list[0].id, 'tmdata-10');
  assert.deepEqual(list[0].match.matched, ['drible']);
  assert.equal(list[0].club, 'Clube Novo', 'clube atual da temporada corrente');
  assert.equal(list[1].id, 'tmdata-11');
  assert.equal(list[1].match.noData, true, 'sem dados recentes fica no fim, sinalizado');

  const before = calls.filter((c) => c === '/trophies').length;
  const p = await fetch(`${base}/api/players/tmdata-10`).then((r) => r.json());
  assert.equal(p.marketValueEur, 3_000_000, 'valor de mercado continua do índice');
  assert.equal(p.seasons[0].season, '2026');
  assert.equal(p.seasons[0].rating, 7.4);
  assert.equal(p.recent.source, 'API-Football');
  assert.deepEqual(p.titles, [{ name: 'Copa do Brasil (Brazil)', season: '2025', club: null }]);
  assert.equal(p.titlesSource, 'API-Football');
  await fetch(`${base}/api/players/tmdata-10`);
  assert.equal(calls.filter((c) => c === '/trophies').length, before + 1, 'títulos ficam em cache');
});

test('títulos: só conquistas (Winner), sem duplicatas', () => {
  assert.deepEqual(normalizeTrophies([
    { league: 'Liga', country: 'Brasil', season: '2024', place: 'Winner' },
    { league: 'Liga', country: 'Brasil', season: '2024', place: 'Winner' },
    { league: 'Copa', season: '2023', place: 'Runner-up' },
  ]), [{ name: 'Liga (Brasil)', season: '2024', club: null }]);
});

test('plano sem acesso à temporada: --check informa claramente e não quebra', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const body = u.pathname.endsWith('/status') ? { errors: [], response: { subscription: { plan: 'Free' }, requests: { current: 0, limit_day: 100 } } }
      : u.pathname.endsWith('/leagues') ? { errors: [], response: [{ league: { name: 'Serie A' }, country: { name: 'Brazil' }, seasons: [{ year: 2026, current: true }] }] }
      : { errors: { plan: 'Free plans do not have access to this season, try from 2022 to 2024.' }, response: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const logs = [];
  const prev = process.env.PASSE_API_FOOTBALL_DIR;
  process.env.PASSE_API_FOOTBALL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'passe-afc-'));
  try {
    await sync({ client: createClient({ key: 'k', baseUrl: 'http://api.invalid/', fetchImpl }), leagues: ['BRA1'], checkOnly: true, log: (m) => logs.push(m) });
  } finally {
    fs.rmSync(process.env.PASSE_API_FOOTBALL_DIR, { recursive: true, force: true });
    if (prev === undefined) delete process.env.PASSE_API_FOOTBALL_DIR; else process.env.PASSE_API_FOOTBALL_DIR = prev;
  }
  assert.ok(logs.some((l) => /SEM acesso à temporada 2026: Free plans do not have access/.test(l)), logs.join('\n'));
});
