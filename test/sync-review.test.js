import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { build, parseCsv, seasonLabel, COUNTRY_CODES } from '../scripts/sync-data.js';
import { getCountry } from '../src/data/countries.js';

function tempDirectory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passe-sync-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'raw'));
  return dir;
}
function csv(rows) {
  const headers = [...new Set(rows.flatMap(Object.keys))];
  const field = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [headers, ...rows.map((r) => headers.map((h) => r[h]))].map((r) => r.map(field).join(',')).join('\r\n');
}
function fixture(dir) {
  const competitions = [
    { competition_id: 'BRA1', name: 'brasileiro', type: 'domestic_league', country_name: 'Brazil', domestic_league_code: 'BRA1' },
    { competition_id: 'GB1', name: 'premier-league', type: 'domestic_league', country_name: 'England', domestic_league_code: 'GB1' },
    { competition_id: 'SC1', name: 'premiership', type: 'domestic_league', country_name: 'Scotland', domestic_league_code: 'SC1' },
    { competition_id: 'FAC', name: 'fa-cup', type: 'domestic_cup', country_name: 'England', domestic_league_code: 'GB1' },
    { competition_id: 'NT', name: 'world-cup', type: 'national_team_competition', country_name: '' },
  ];
  const clubs = [{ club_id: '1', name: 'Clube, São João', domestic_competition_id: 'BRA1' },
    { club_id: '2', name: 'English club', domestic_competition_id: 'GB1' }];
  const base = { player_id: '7', name: 'João "Pé" Silva', last_season: '2025', current_club_id: '1',
    current_club_domestic_competition_id: 'GB1', sub_position: 'Centre-Forward', date_of_birth: '2000-11-11',
    country_of_citizenship: 'Argentina', market_value_in_eur: '1000000' };
  const players = [base, { ...base, player_id: '8', last_season: '' }, { ...base, player_id: '9', name: 'Sem stats' }];
  const games = [];
  const appearances = [];
  function add(id, season, competition, date, club, goals, assists = '0') {
    games.push({ game_id: id, season, competition_id: competition, date });
    appearances.push({ game_id: id, player_id: '7', player_club_id: club, competition_id: competition,
      minutes_played: '90', goals, assists, yellow_cards: '0', red_cards: '0' });
  }
  for (let i = 0; i < 5; i++) {
    add(`b${i}`, '2024', 'BRA1', i === 4 ? '2026-01-02' : '2025-05-01', '1', '1');
    add(`e${i}`, '2024', 'GB1', '2025-05-01', '2', '2');
    add(`n${i}`, '2025', 'GB1', '2026-05-01', '2', '0');
  }
  add('cup', '2025', 'FAC', '2026-05-10', '2', '3');
  add('national', '2025', 'NT', '2026-06-01', '1', '99');
  appearances.push({ ...appearances[0] }); // duplicata não pode dobrar totais
  const tables = { competitions, clubs, players, games, appearances };
  for (const [name, rows] of Object.entries(tables)) fs.writeFileSync(path.join(dir, 'raw', `${name}.csv.gz`), zlib.gzipSync(csv(rows)));
  return tables;
}

test('CSV é invariável a qualquer divisão de chunks, inclusive UTF-8, BOM e aspas escapadas', async () => {
  const input = Buffer.from('\uFEFFa,b,c\r\n"João, Ç","diz ""olá""",\r\n1,,"linha\r\nnova"\r\n,,""');
  const expected = [['a', 'b', 'c'], ['João, Ç', 'diz "olá"', ''], ['1', '', 'linha\r\nnova'], ['', '', '']];
  for (let split = 1; split < input.length; split++) {
    const rows = [];
    for await (const row of parseCsv(Readable.from([input.subarray(0, split), input.subarray(split)]))) rows.push(row);
    assert.deepEqual(rows, expected, `chunk split ${split}`);
  }
  const rows = [];
  for await (const row of parseCsv(Readable.from([...input].map((byte) => Buffer.from([byte]))))) rows.push(row);
  assert.deepEqual(rows, expected);
});

test('CSV malformado falha em vez de gerar índice silenciosamente truncado', async () => {
  for (const input of ['a,b\n"ab', 'a,b\n"ab"cd,x', 'a,b\nx"y,z']) {
    await assert.rejects(async () => { for await (const _ of parseCsv(Readable.from([input]))) { /* consume */ } }, /CSV inválido/);
  }
});

test('sync separa competição/time/período, preserva ano civil adiado e não mistura seleções', async (t) => {
  const dir = tempDirectory(t);
  fixture(dir);
  const index = await build({ dataDir: dir, skipDownload: true, now: new Date('2026-11-10T12:00:00Z'), log() {} });
  assert.equal(index.schemaVersion, 2);
  assert.equal(index.players.length, 2, 'sem last_season não é tratado como jogador ativo');
  assert.ok(index.leagues.every((l) => getCountry(l.country)));
  const p = index.players.find((p) => p.id === 'tmdata-7');
  assert.equal(p.name, 'João "Pé" Silva');
  assert.equal(p.club, 'Clube, São João');
  assert.equal(p.leagueCountry, 'BR', 'liga do clube tem precedência sobre campo redundante desatualizado');
  assert.equal(p.nationality, 'AR');
  assert.equal(p.age, 25);
  assert.equal(p.seasons.length, 4);
  const civil = p.seasons.find((s) => s.competitionId === 'BRA1');
  assert.equal(civil.season, '2025');
  assert.equal(civil.appearances, 5, 'deduplica jogador/jogo');
  assert.equal(civil.goals, 5);
  const cup = p.seasons.find((s) => s.competitionId === 'FAC');
  assert.equal(cup.goals, 3);
  assert.equal(cup.league, 'Fa Cup');
  assert.equal(p.season, '2025/26');
  assert.equal(p.minutes, 540);
  assert.equal(p.stats.goals, 0.5);
  assert.equal(p.appearances, 6);
  assert.equal(index.source.lastGameDate, '2026-05-10');
  assert.deepEqual(index.players.find((p) => p.id === 'tmdata-9').stats, {});
  assert.deepEqual(p.titles, []);
  assert.equal(seasonLabel(2024, 'BRA1'), '2025');
  assert.equal(seasonLabel(2024, 'GB1'), '2024/25');
  assert.equal(COUNTRY_CODES['Korea, South'], 'KR');
  assert.equal(COUNTRY_CODES.Croatia, 'HR');
  assert.equal(COUNTRY_CODES.Scotland, 'SCT'); // convenção explícita do catálogo PASSE
});

test('sync mantém estatística ausente como desconhecida e preserva índice em erro de schema', async (t) => {
  const dir = tempDirectory(t);
  const tables = fixture(dir);
  tables.appearances.find((a) => a.game_id === 'cup').goals = '';
  fs.writeFileSync(path.join(dir, 'raw', 'appearances.csv.gz'), zlib.gzipSync(csv(tables.appearances)));
  const index = await build({ dataDir: dir, skipDownload: true, log() {} });
  assert.equal(index.players[0].stats.goals, undefined);
  const prior = fs.readFileSync(path.join(dir, 'players.json'), 'utf8');
  fs.writeFileSync(path.join(dir, 'raw', 'games.csv.gz'), zlib.gzipSync('wrong,header\nx,y'));
  await assert.rejects(build({ dataDir: dir, skipDownload: true, log() {} }), /cabeçalho/);
  assert.equal(fs.readFileSync(path.join(dir, 'players.json'), 'utf8'), prior);
});

test('download corrompido não substitui raw válido nem índice anterior', async (t) => {
  const dir = tempDirectory(t);
  fixture(dir);
  const raw = fs.readFileSync(path.join(dir, 'raw', 'competitions.csv.gz'));
  await assert.rejects(build({ dataDir: dir, force: true, fetchImpl: async () => new Response('not gzip'), log() {} }));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'raw', 'competitions.csv.gz')), raw);
  assert.equal(fs.existsSync(path.join(dir, 'raw', 'competitions.csv.gz.part')), false);
});
