import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSofascoreProvider, mapSofascoreCharacteristics } from '../src/providers/sofascoreProvider.js';
import { createTransfermarktProvider } from '../src/providers/transfermarktProvider.js';
import { createApiFootballProvider } from '../src/providers/apiFootballProvider.js';
import { createHttpClient } from '../src/providers/httpClient.js';
import { activeProviders, getPlayerById, registerProvider, searchAll } from '../src/providers/index.js';
import { normalizeHeatmap } from '../src/providers/dashboard.js';

const sofaEnv = () => ({ PASSE_SOFASCORE_AUTHORIZED: 'true', PASSE_SOFASCORE_URL: 'https://licensed.example/feed/',
  PASSE_SOFASCORE_TOKEN: 'test-key', PASSE_SOFASCORE_TYPE_MAP: '{"101":"finalizacao","205":"desarme"}' });
const seasons = [{ season: '2026', club: 'Club', league: 'Liga', appearances: 20, minutes: 1500, goals: 10, assists: 2, rating: 7.1 }];
const heatmap = { season: '2026', competition: 'Liga', points: [{ x: 80, y: 40, count: 3 }] };
const feedPlayer = () => ({ id: '123', name: 'Player', position: 'ST', age: 24, nationality: 'Argentina',
  leagueCountry: 'BR', league: 'Liga', club: 'Club', marketValueEur: 900000, foot: 'right',
  photoUrl: 'https://media.licensed.example/player.jpg',
  links: { sofascore: 'https://www.sofascore.com/football/player/player/123' },
  characteristics: { positive: [{ type: 101 }, 'dribbling'], negative: [205] }, seasons, heatmap,
  titles: [{ name: 'Cup', season: '2025', club: 'Club' }] });

test('SofaScore mapeia fortes/fracos sem inventar enumeração, deduplica e descarta contradição', () => {
  assert.deepEqual(mapSofascoreCharacteristics({ positive: [101, { type: 101 }, 'dribbling', 'passing', 999],
    negative: ['passing', 205] }, { 101: 'finalizacao', 205: 'desarme' }),
  { positive: ['finalizacao', 'drible'], negative: ['desarme'], source: 'fonte' });
  assert.equal(mapSofascoreCharacteristics({ positive: [101], negative: [] }), null);
  assert.equal(mapSofascoreCharacteristics(null), null);
  assert.deepEqual(mapSofascoreCharacteristics({ positive: [], negative: [] }), { positive: [], negative: [], source: 'fonte' });
});

test('SofaScore sem configuração/autorização válida não faz chamadas', async () => {
  for (const env of [{}, { ...sofaEnv(), PASSE_SOFASCORE_AUTHORIZED: 'false' },
    { ...sofaEnv(), PASSE_SOFASCORE_URL: 'https://api.sofascore.com/' },
    { ...sofaEnv(), PASSE_SOFASCORE_TYPE_MAP: '{"101":"invalid"}' },
    { ...sofaEnv(), PASSE_SOFASCORE_PLAYER_IDS: '[]' }]) {
    const p = createSofascoreProvider({ env, clientFactory: () => { throw new Error('não chamar'); } });
    assert.equal(p.isEnabled(), false);
    assert.deepEqual(await p.searchPlayers(), []);
    assert.equal(await p.getPlayer('sofascore-123'), null);
    const original = { id: 'transfermarkt-7' };
    assert.equal(await p.enrichPlayer(original, { sofascoreId: '123' }), original);
  }
});

test('SofaScore preenche dashboard e mantém rating da fonte, sem notas PASSE', async () => {
  const p = createSofascoreProvider({ env: sofaEnv(), clientFactory: (options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    return { get: async (resource) => resource === 'players' ? { players: [feedPlayer()] } : { player: feedPlayer() } };
  } });
  const [player] = await p.searchPlayers({ position: 'ST', maxBudgetEur: 1000000 });
  assert.equal(player.photoUrl, feedPlayer().photoUrl);
  assert.deepEqual(player.characteristics, { positive: ['finalizacao', 'drible'], negative: ['desarme'], source: 'fonte' });
  assert.deepEqual(player.heatmap, heatmap);
  assert.deepEqual(player.seasons, seasons);
  assert.equal(player.leagueCountry, 'BR');
  assert.equal(player.nationality, 'Argentina');
  assert.deepEqual(player.titles, feedPlayer().titles);
  assert.deepEqual(player.links, feedPlayer().links);
  assert.equal(player.attributes, undefined);
  assert.deepEqual(await p.getPlayer('sofascore-123'), player);
});

test('SofaScore aplica filtros localmente, pagina e rejeita loops/truncamento', async () => {
  const cursors = [];
  const p = createSofascoreProvider({ env: sofaEnv(), clientFactory: () => ({ get: async (_resource, params) => {
    cursors.push(params.cursor);
    if (!params.cursor) return { players: [feedPlayer(), { ...feedPlayer(), id: '124', leagueCountry: null }], nextCursor: 'second' };
    return { players: [{ ...feedPlayer(), id: '125', marketValueEur: null }, { ...feedPlayer(), id: '126', position: 'GK' }] };
  } }) });
  assert.deepEqual((await p.searchPlayers({ position: 'ST', maxBudgetEur: 1000000 })).map((p) => p.id), ['sofascore-123']);
  assert.deepEqual(cursors, [undefined, 'second']);
  const loop = createSofascoreProvider({ env: sofaEnv(), clientFactory: () => ({ get: async () => ({ players: [], nextCursor: 'loop' }) }) });
  await assert.rejects(loop.searchPlayers(), /paginação/);
});

test('heatmap aceita limites e count padrão; ignora coordenadas e contagens inválidas', () => {
  assert.deepEqual(normalizeHeatmap({ season: 2026, competition: 'Liga', points: [
    { x: 0, y: 100 }, { x: 101, y: 20 }, { x: -1, y: 20 }, { x: null, y: 20 },
    { x: 10, y: 10, count: 0 }, { x: 10, y: 10, count: Infinity }, null,
  ] }), { season: '2026', competition: 'Liga', points: [{ x: 0, y: 100, count: 1 }] });
  assert.equal(normalizeHeatmap({ points: [{ x: NaN, y: 2 }] }), null);
});

test('enriquecedor usa ID explícito e feed parcial, preservando identidade e dados primários', async () => {
  let calls = 0;
  const p = createSofascoreProvider({ env: sofaEnv(), clientFactory: () => ({ get: async () => {
    calls++;
    return { player: { ...feedPlayer(), name: 'Wrong name', club: 'Wrong club', leagueCountry: 'PT', marketValueEur: 1 } };
  } }) });
  const original = { id: 'transfermarkt-7', source: 'transfermarkt', name: 'Primary', club: 'Primary club',
    leagueCountry: 'BR', marketValueEur: 3000000, stats: { goals: 0.5 },
    seasons: [{ ...seasons[0], rating: null }], titles: [], photoUrl: null,
    links: { transfermarkt: 'https://www.transfermarkt.com/player/7' } };
  assert.equal(await p.enrichPlayer(original), original);
  assert.equal(calls, 0);
  const enriched = await p.enrichPlayer(original, { sofascoreId: '123' });
  for (const key of ['id', 'source', 'name', 'club', 'leagueCountry', 'marketValueEur', 'stats', 'seasons']) assert.deepEqual(enriched[key], original[key]);
  assert.equal(enriched.characteristics.source, 'fonte');
  assert.deepEqual(enriched.heatmap, heatmap);
  assert.equal(enriched.photoUrl, feedPlayer().photoUrl);
  assert.equal(enriched.links.transfermarkt, original.links.transfermarkt);
  assert.equal(enriched.links.sofascore, feedPlayer().links.sofascore);
  assert.deepEqual(enriched.titles, feedPlayer().titles);
  assert.equal(original.characteristics, undefined);
  const partial = createSofascoreProvider({ env: { ...sofaEnv(), PASSE_SOFASCORE_PLAYER_IDS: '{"transfermarkt-7":"123"}' },
    clientFactory: () => ({ get: async () => ({ player: { id: '123', characteristics: { positive: ['passing'], negative: [] } } }) }) });
  assert.deepEqual((await partial.enrichPlayer(original)).characteristics.positive, ['passe']);
});

test('enriquecedor falha aberto em 403 sem retry e respeita a pausa do cliente', async (t) => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'passe-sofa-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  let calls = 0;
  const p = createSofascoreProvider({ env: sofaEnv(), clientFactory: (options) => createHttpClient({ ...options, cacheDir,
    sleep: async () => {}, fetchImpl: async (_url, init) => {
      calls++;
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers['User-Agent'], undefined);
      return new Response('{}', { status: 403 });
    } }) });
  const original = { id: 'transfermarkt-7' };
  assert.equal(await p.enrichPlayer(original, { sofascoreId: '123' }), original);
  assert.equal(await p.enrichPlayer(original, { sofascoreId: '124' }), original);
  assert.equal(calls, 1);
});

test('SofaScore rejeita IDs divergentes e URLs perigosas, sem substituir dados existentes', async () => {
  const p = createSofascoreProvider({ env: sofaEnv(), clientFactory: () => ({ get: async () => ({ player: { id: '999' } }) }) });
  await assert.rejects(p.getPlayer('sofascore-123'), /identidade/);
  assert.equal(await p.getPlayer('sofascore-../123'), null);
  const original = { id: 'transfermarkt-7' };
  assert.equal(await p.enrichPlayer(original, { sofascoreId: '123' }), original);
  const badPhoto = createSofascoreProvider({ env: sofaEnv(), clientFactory: () => ({ get: async () => ({ player:
    { ...feedPlayer(), photoUrl: 'javascript:alert(1)', links: { sofascore: 'data:text/html,test' } } }) }) });
  const player = await badPhoto.getPlayer('sofascore-123');
  assert.equal(player.photoUrl, null);
  assert.deepEqual(player.links, {});
});

test('Transfermarkt detalhe preenche foto, temporadas separadas e conquistas v4', async () => {
  const env = { PASSE_TRANSFERMARKT_AUTHORIZED: 'true', PASSE_TRANSFERMARKT_URL: 'https://licensed.example/',
    PASSE_TRANSFERMARKT_SEASON: '2026', PASSE_TRANSFERMARKT_CLUBS:
      '[{"id":"10","name":"Club","league":"Liga","country":"BR","competitionId":"BRA1"}]' };
  const p = createTransfermarktProvider({ env, clientFactory: () => ({ get: async (resource) => {
    if (resource === 'clubs/10/players') return { players: [{ id: '7', name: 'Player', position: 'Centre-Back' }] };
    if (resource.endsWith('/profile')) return { imageUrl: 'https://media.licensed.example/tm.jpg' };
    if (resource.endsWith('/achievements')) return { achievements: [
      { title: 'Champion', count: 2, details: [{ season: { id: '2025', name: '2025/26' }, club: { name: 'Club' } },
        { season: { id: '2024' }, club: { name: 'Previous club' } }] },
      { title: 'Award', count: 3, details: [] },
    ] };
    return { stats: [
      { seasonId: '2026', clubId: '10', competitionId: 'BRA1', appearances: 2, minutesPlayed: 180, goals: 2, assists: 1 },
      { seasonId: '2025', clubId: '9', competitionId: 'CUP', competitionName: 'Cup', appearances: 1, minutesPlayed: 90, goals: 1, assists: 0 },
    ] };
  } }) });
  const player = await p.getPlayer('transfermarkt-7');
  assert.equal(player.photoUrl, 'https://media.licensed.example/tm.jpg');
  assert.equal(player.seasons.length, 2);
  assert.equal(player.seasons[0].goals, 2);
  assert.equal(player.seasons[0].rating, null);
  assert.equal(player.seasons[1].club, null);
  assert.equal(player.stats.goals, 1);
  assert.deepEqual(player.titles, [{ name: 'Champion', season: '2025/26', club: 'Club' },
    { name: 'Champion', season: '2024', club: 'Previous club' }, { name: 'Award', season: null, club: null }]);
  assert.equal(player.characteristics, null);
  assert.equal(player.heatmap, null);
});

test('Transfermarkt mantém ficha básica se endpoints opcionais falham', async () => {
  const p = createTransfermarktProvider({ env: { PASSE_TRANSFERMARKT_AUTHORIZED: 'true', PASSE_TRANSFERMARKT_URL: 'https://licensed.example/',
    PASSE_TRANSFERMARKT_SEASON: '2026', PASSE_TRANSFERMARKT_CLUBS:
      '[{"id":"10","name":"Club","league":"Liga","country":"BR","competitionId":"BRA1"}]' },
  clientFactory: () => ({ get: async (resource) => {
    if (resource === 'clubs/10/players') return { players: [{ id: '7', name: 'Player', position: 'ST', imageUrl: 'https://media.licensed.example/tm.jpg' }] };
    throw new Error('HTTP 403');
  } }) });
  const player = await p.getPlayer('transfermarkt-7');
  assert.equal(player.name, 'Player');
  assert.equal(player.photoUrl, 'https://media.licensed.example/tm.jpg');
  assert.deepEqual(player.seasons, []);
  assert.deepEqual(player.titles, []);
});

test('API-Football foto e temporadas mantêm time, totais e rating original', async () => {
  const p = createApiFootballProvider({ env: { PASSE_API_FOOTBALL_KEY: 'key', PASSE_API_FOOTBALL_SEASON: '2026',
    PASSE_API_FOOTBALL_LEAGUES: '[{"id":"71","name":"Liga","country":"BR"}]' }, clientFactory: () => ({ get: async () => ({
    response: [{ player: { id: 9, name: 'Player', photo: 'https://media.licensed.example/api.jpg' }, statistics: [
      { team: { name: 'Club' }, league: { id: 71, season: 2026 }, games: { position: 'Goalkeeper', minutes: 180, appearences: 2, rating: '7.12' }, goals: { total: 0, assists: null } },
      { team: { name: 'Other club' }, league: { id: 71, season: 2026 }, games: { position: 'Goalkeeper', minutes: 90, appearences: 1 }, goals: {} },
    ] }], paging: { total: 1 },
  }) }) });
  const player = await p.getPlayer('api-football-9');
  assert.equal(player.photoUrl, 'https://media.licensed.example/api.jpg');
  assert.equal(player.seasons[0].rating, 7.12);
  assert.equal(player.seasons[0].appearances, 2);
  assert.equal(player.seasons[0].goals, 0);
  assert.equal(player.seasons[0].assists, null);
  assert.equal(player.seasons[1].club, 'Other club');
  assert.equal(player.seasons[1].rating, null);
  assert.equal(player.characteristics, null);
});

test('SofaScore participa do registro e falha isoladamente sem quebrar demo', async (t) => {
  const previous = process.env.PASSE_PROVIDERS;
  t.after(() => { if (previous === undefined) delete process.env.PASSE_PROVIDERS; else process.env.PASSE_PROVIDERS = previous; });
  const p = createSofascoreProvider({ env: sofaEnv(), clientFactory: () => ({ get: async () => { throw new Error('HTTP 403'); } }) });
  registerProvider(p);
  process.env.PASSE_PROVIDERS = 'demo,sofascore';
  assert.deepEqual(activeProviders().map((p) => p.name), ['demo', 'sofascore']);
  const result = await searchAll({ position: 'ST' });
  assert.ok(result.players.some((p) => p.source === 'demo'));
  assert.deepEqual(result.errors, [{ provider: 'sofascore', message: 'HTTP 403' }]);
  await assert.rejects(getPlayerById('sofascore-123'), /403/);
});
