import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTmdataProvider } from '../src/providers/tmdataProvider.js';
import { tmdataDirectory, PROJECT_ROOT } from '../src/providers/tmdataPaths.js';
import { createTransfermarktProvider } from '../src/providers/transfermarktProvider.js';
import { createApiFootballProvider } from '../src/providers/apiFootballProvider.js';
import { createSofascoreProvider } from '../src/providers/sofascoreProvider.js';
import { activeProviders, availableCharacteristics, registerProvider, sourcesInfo } from '../src/providers/index.js';

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passe-tmdata-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const player = (id = '1') => ({ id: `tmdata-${id}`, source: 'tmdata', name: 'Player', position: 'ST', leagueCountry: 'BR',
  marketValueEur: 100, age: 99, dateOfBirth: '2000-11-11', minutes: 900, stats: { goals: 0.8 },
  seasons: [{ season: '2025/26', goals: 8 }], titles: [] });
function write(dir, players) {
  fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify({ source: { license: 'CC0 1.0', lastGameDate: '2026-07-06' }, players }));
}

test('tmdata descarta linhas inválidas, rejeita orçamento desconhecido e não expõe cache mutável', async (t) => {
  const dir = directory(t);
  write(dir, [player(), null, { ...player('2'), name: '' }, { ...player('3'), leagueCountry: 'ZZ' },
    { ...player('4'), marketValueEur: '1', stats: { goals: '10', assists: -1 } },
    { ...player('5'), marketValueEur: -2 }]);
  const p = createTmdataProvider({ env: { PASSE_TMDATA_DIR: dir }, now: () => new Date('2026-11-10T12:00:00Z') });
  assert.equal(p.isEnabled(), true);
  assert.equal(p.info().players, 3);
  assert.deepEqual((await p.searchPlayers({ position: 'st', maxBudgetEur: 100 })).map((p) => p.id), ['tmdata-1']);
  const found = await p.getPlayer('tmdata-1');
  assert.equal(found.age, 25);
  found.stats.goals = 999;
  found.seasons[0].goals = 999;
  const again = await p.getPlayer('tmdata-1');
  assert.equal(again.stats.goals, 0.8);
  assert.equal(again.seasons[0].goals, 8);
  assert.equal((await p.getPlayer('tmdata-4')).marketValueEur, null);
  assert.deepEqual((await p.getPlayer('tmdata-4')).stats, {});
  assert.equal(await p.getPlayer('tmdata-../1'), null);
});

test('tmdata recarrega substituição atômica e desabilita índice corrompido/ausente', async (t) => {
  const dir = directory(t);
  write(dir, [player()]);
  const p = createTmdataProvider({ env: { PASSE_TMDATA_DIR: dir } });
  assert.equal((await p.getPlayer('tmdata-1')).name, 'Player');
  const replacement = path.join(dir, 'next.json');
  fs.writeFileSync(replacement, JSON.stringify({ players: [{ ...player(), name: 'New' }] }));
  fs.renameSync(replacement, path.join(dir, 'players.json'));
  assert.equal((await p.getPlayer('tmdata-1')).name, 'New');
  fs.writeFileSync(path.join(dir, 'players.json'), '{broken');
  assert.equal(p.isEnabled(), false);
  await assert.rejects(p.searchPlayers(), /sync-data/);
  fs.rmSync(path.join(dir, 'players.json'));
  assert.equal(p.isEnabled(), false);
  assert.equal(await p.getPlayer('tmdata-1'), null);
  assert.equal(tmdataDirectory('.cache/tmdata'), path.join(PROJECT_ROOT, '.cache', 'tmdata'));
});

test('idade atravessa aniversário sem novo sync e datas impossíveis não geram idade', async (t) => {
  const dir = directory(t);
  write(dir, [player(), { ...player('2'), dateOfBirth: '2000-02-31' }]);
  let date = new Date('2026-11-10T12:00:00Z');
  const p = createTmdataProvider({ env: { PASSE_TMDATA_DIR: dir }, now: () => date });
  assert.equal((await p.getPlayer('tmdata-1')).age, 25);
  date = new Date('2026-11-11T12:00:00Z');
  assert.equal((await p.getPlayer('tmdata-1')).age, 26);
  assert.equal((await p.getPlayer('tmdata-2')).age, null);
});

test('capacidade das APIs corresponde às estatísticas fornecidas, sem prometer todo vocabulário', () => {
  const env = {};
  const tm = createTransfermarktProvider({ env });
  assert.deepEqual(tm.characteristics, []);
  env.PASSE_TRANSFERMARKT_INCLUDE_STATS = 'true';
  assert.deepEqual(tm.characteristics, ['finalizacao', 'criacao']);
  const api = createApiFootballProvider({ env: {} });
  assert.ok(api.characteristics.includes('drible'));
  assert.ok(!api.characteristics.includes('velocidade'));
  assert.ok(!api.characteristics.includes('passe'));
});

test('registro usa fallback apenas por padrão e capacidades de enriquecimento exigem IDs da fonte ativa', async (t) => {
  const dir = directory(t);
  write(dir, [player()]);
  const keys = ['PASSE_PROVIDERS', 'PASSE_TMDATA_DIR'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => { for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
  process.env.PASSE_TMDATA_DIR = dir;
  delete process.env.PASSE_PROVIDERS;
  assert.deepEqual(activeProviders().map((p) => p.name), ['tmdata']);
  const env = { PASSE_SOFASCORE_AUTHORIZED: 'true', PASSE_SOFASCORE_URL: 'https://licensed.example/' };
  registerProvider(createSofascoreProvider({ env }));
  assert.deepEqual(availableCharacteristics(), ['finalizacao', 'criacao']);
  env.PASSE_SOFASCORE_PLAYER_IDS = '{"transfermarkt-1":"123"}';
  assert.deepEqual(availableCharacteristics(), ['finalizacao', 'criacao']);
  env.PASSE_SOFASCORE_PLAYER_IDS = '{"tmdata-1":"123"}';
  assert.ok(availableCharacteristics().includes('drible'));
  fs.writeFileSync(path.join(dir, 'players.json'), 'broken');
  assert.deepEqual(activeProviders().map((p) => p.name), ['demo']);
  process.env.PASSE_PROVIDERS = 'tmdata';
  assert.deepEqual(activeProviders(), []);
  assert.deepEqual(sourcesInfo(), []);
});
