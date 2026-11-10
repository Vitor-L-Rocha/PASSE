import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHttpClient, allowedBaseUrl } from '../src/providers/httpClient.js';
import { createTransfermarktProvider } from '../src/providers/transfermarktProvider.js';
import { createApiFootballProvider } from '../src/providers/apiFootballProvider.js';
import { activeProviders, getPlayerById, registerProvider, searchAll } from '../src/providers/index.js';

async function cacheDirectory(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'passe-providers-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });

test('cache coalesce, persiste, expira e não grava credenciais', async (t) => {
  const cacheDir = await cacheDirectory(t);
  let calls = 0;
  let time = 1000;
  const options = { namespace: 'test', baseUrl: 'https://licensed.example/', cacheDir,
    ttlMs: 100, intervalMs: 10, headers: { Authorization: 'secret-test' },
    now: () => time, sleep: async (ms) => { time += ms; },
    fetchImpl: async () => { calls++; return response({ ok: calls }); } };
  const client = createHttpClient(options);
  const [a, b] = await Promise.all([client.get('players'), client.get('players')]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.deepEqual(await createHttpClient(options).get('players'), a);
  assert.equal(calls, 1);
  const files = await readdir(cacheDir);
  assert.equal(files.length, 1);
  assert.ok(!(await readFile(path.join(cacheDir, files[0]), 'utf8')).includes('secret-test'));
  time += 101;
  await client.get('players');
  assert.equal(calls, 2);
});

test('fila aplica intervalo mesmo com chamadas simultâneas e falhas', async (t) => {
  const starts = [];
  let time = 0;
  const client = createHttpClient({ namespace: 'rate', baseUrl: 'https://licensed.example/',
    cacheDir: await cacheDirectory(t), intervalMs: 100, now: () => time,
    sleep: async (ms) => { time += ms; },
    fetchImpl: async () => { starts.push(time); return response({}, starts.length === 1 ? 500 : 200); } });
  const results = await Promise.allSettled([client.get('a'), client.get('b'), client.get('c')]);
  assert.deepEqual(starts, [0, 100, 200]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[2].status, 'fulfilled');
});

test('403/429 interrompem chamadas enfileiradas e respeitam Retry-After', async (t) => {
  for (const status of [403, 429]) {
    let calls = 0;
    let time = 0;
    const client = createHttpClient({ namespace: `blocked-${status}`, baseUrl: 'https://licensed.example/',
      cacheDir: await cacheDirectory(t), now: () => time, sleep: async () => {},
      fetchImpl: async () => { calls++; return response({}, status, { 'Retry-After': '120' }); } });
    await Promise.allSettled([client.get('a'), client.get('b')]);
    assert.equal(calls, 1);
    time = 61000;
    await assert.rejects(client.get('c'), /aguarde/);
    time = 121000;
    await assert.rejects(client.get('d'), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 2);
  }
});

test('erro semântico não é cacheado e rede/JSON inválido são erros controlados', async (t) => {
  let calls = 0;
  const client = createHttpClient({ namespace: 'invalid', baseUrl: 'https://licensed.example/',
    cacheDir: await cacheDirectory(t), sleep: async () => {},
    validate(data) { if (data.errors) throw new Error('recusado'); },
    fetchImpl: async () => { calls++; return response({ errors: true }); } });
  await assert.rejects(client.get('players'), /recusado/);
  await assert.rejects(client.get('players'), /recusado/);
  assert.equal(calls, 2);
  for (const fetchImpl of [async () => { throw new Error('contains-secret'); }, async () => new Response('not json')]) {
    const bad = createHttpClient({ namespace: 'bad', baseUrl: 'https://licensed.example/',
      cacheDir: await cacheDirectory(t), fetchImpl, sleep: async () => {} });
    await assert.rejects(bad.get('bad'), /falha de rede|JSON inválida/);
  }
});

const tmEnv = () => ({ PASSE_TRANSFERMARKT_AUTHORIZED: 'true', PASSE_TRANSFERMARKT_URL: 'https://licensed.example/v4/',
  PASSE_TRANSFERMARKT_SEASON: '2026', PASSE_TRANSFERMARKT_INCLUDE_STATS: 'true',
  PASSE_TRANSFERMARKT_CLUBS: JSON.stringify([{ id: '10', name: 'Club', league: 'Liga Portugal', country: 'PT', competitionId: 'PO1' }]) });
const tmPlayer = { id: '7', name: 'Real player', nationality: ['Brazil'], position: 'Centre-Back',
  age: 23, height: 185, foot: 'left', marketValue: 2000000, contract: '2027-06-30' };

test('Transfermarkt normaliza squad v4 e limita stats à liga/clube/temporada', async () => {
  const provider = createTransfermarktProvider({ env: tmEnv(), clientFactory: () => ({
    async get(resource, params) {
      if (resource.includes('/players')) {
        assert.equal(params.season_id, '2026');
        return { players: [tmPlayer, { ...tmPlayer, id: '8', marketValue: null }] };
      }
      return { stats: [
        { clubId: '10', competitionId: 'PO1', seasonId: '2026', minutesPlayed: 180, goals: 2, assists: 1, appearances: 2 },
        { clubId: '10', competitionId: 'CUP', seasonId: '2026', minutesPlayed: 90, goals: 20, assists: 0, appearances: 1 },
      ] };
    },
  }) });
  const [p, ...others] = await provider.searchPlayers({ position: 'CB', maxBudgetEur: 3000000 });
  assert.equal(others.length, 0);
  assert.equal(p.leagueCountry, 'PT');
  assert.equal(p.nationality, 'Brazil');
  assert.equal(p.stats.goals, 1);
  assert.equal(p.stats.assists, 0.5);
  assert.equal(p.foot, 'esquerdo');
  assert.deepEqual(await provider.getPlayer(p.id), p);
  assert.equal(await provider.getPlayer('transfermarkt-../secret'), null);
});

test('provedores sem configuração/autorização ficam inativos e não fazem rede', async () => {
  for (const factory of [createTransfermarktProvider, createApiFootballProvider]) {
    const p = factory({ env: {}, clientFactory: () => { throw new Error('não deveria chamar'); } });
    assert.equal(p.isEnabled(), false);
    assert.deepEqual(await p.searchPlayers(), []);
    assert.equal(await p.getPlayer('transfermarkt-7'), null);
  }
  const env = tmEnv();
  env.PASSE_TRANSFERMARKT_AUTHORIZED = 'false';
  assert.equal(createTransfermarktProvider({ env }).isEnabled(), false);
  for (const url of ['https://www.transfermarkt.com/', 'https://www.sofascore.com/', 'https://api.sofascore.com/', 'file:///tmp/a', 'https://user:password@host/']) {
    assert.equal(allowedBaseUrl(url), null, url);
  }
});

const afEnv = () => ({ PASSE_API_FOOTBALL_KEY: 'test-key', PASSE_API_FOOTBALL_SEASON: '2026',
  PASSE_API_FOOTBALL_LEAGUES: '[{"id":"71","country":"BR","name":"Serie A"}]',
  PASSE_API_FOOTBALL_METADATA: '{"9":{"position":"ST","marketValueEur":500000}}' });
const afRow = { player: { id: 9, name: 'Player', age: 20, nationality: 'Argentina', height: '180 cm' },
  statistics: [{ league: { id: 71, season: 2026 }, team: { name: 'Club' },
    games: { position: 'Attacker', minutes: 180, appearences: 2, rating: '7.20' },
    goals: { total: 2, assists: 1 }, passes: { accuracy: 37, key: 4 }, duels: { total: 10, won: 6 } }] };

test('API-Football pagina, normaliza por90 e não confunde passes.accuracy com %', async () => {
  const pages = [];
  const p = createApiFootballProvider({ env: afEnv(), clientFactory: (options) => {
    assert.equal(options.headers['x-apisports-key'], 'test-key');
    return { async get(_resource, params) {
      if (params.id) return { response: [afRow], paging: { total: 1 } };
      pages.push(params.page);
      return { response: [afRow], paging: { total: 2 } };
    } };
  } });
  assert.equal(p.isEnabled(), true);
  const result = await p.searchPlayers({ position: 'ST', maxBudgetEur: 500000 });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.length, 1);
  assert.equal(result[0].leagueCountry, 'BR');
  assert.equal(result[0].stats.goals, 1);
  assert.equal(result[0].stats.passAccuracy, undefined);
  assert.equal(result[0].stats.duelsWonPct, 60);
  assert.equal(result[0].heightCm, 180);
  assert.deepEqual(await p.getPlayer('api-football-9'), result[0]);
});

test('API-Football rejeita erros HTTP 200 e truncamento de paginação', async () => {
  for (const data of [{ errors: { token: 'bad' }, response: [] }, { response: [], paging: { total: 2 } }]) {
    const p = createApiFootballProvider({ env: { ...afEnv(), PASSE_API_FOOTBALL_MAX_PAGES: '1' },
      clientFactory: () => ({ get: async () => data }) });
    await assert.rejects(p.searchPlayers(), /recusou|limite de páginas/);
  }
});

test('fontes sem valores/posições específicos não inventam metadados', async () => {
  const env = afEnv();
  env.PASSE_API_FOOTBALL_METADATA = '{}';
  const p = createApiFootballProvider({ env, clientFactory: () => ({ get: async () => ({ response: [afRow], paging: { total: 1 } }) }) });
  assert.deepEqual(await p.searchPlayers({ maxBudgetEur: 1000000 }), []);
});

test('registro isola throws síncronos, retorno inválido e IDs com hífen', async (t) => {
  const previous = process.env.PASSE_PROVIDERS;
  t.after(() => { if (previous === undefined) delete process.env.PASSE_PROVIDERS; else process.env.PASSE_PROVIDERS = previous; });
  const base = { isEnabled: () => true, getPlayer: async (id) => ({ id }) };
  registerProvider({ ...base, name: 'test-sync', searchPlayers() { throw new Error('sync failure'); } });
  registerProvider({ ...base, name: 'test-invalid', searchPlayers: async () => null });
  registerProvider({ ...base, name: 'test-good', searchPlayers: async () => [{ id: 'test-good-1' }] });
  process.env.PASSE_PROVIDERS = 'test-sync,test-invalid,test-good,test-good,demo';
  const result = await searchAll({ position: 'GK' });
  assert.equal(result.errors.length, 2);
  assert.equal(result.providers.filter((n) => n === 'test-good').length, 1);
  assert.ok(result.players.some((p) => p.source === 'demo'));
  assert.deepEqual(await getPlayerById('test-good-1'), { id: 'test-good-1' });
  process.env.PASSE_PROVIDERS = 'demo';
  assert.equal(await getPlayerById('test-good-1'), null);
  assert.equal(activeProviders().length, 1);
});
