import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../src/server.js';

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const close = (server) => new Promise((resolve) => server.close(resolve));

test('tmdata recebe características antes do ranking e mantém identidade no detalhe; 403 não derruba busca', async () => {
  const keys = ['PASSE_PROVIDERS', 'PASSE_TMDATA_DIR', 'PASSE_SOFASCORE_URL', 'PASSE_SOFASCORE_AUTHORIZED',
    'PASSE_SOFASCORE_PLAYER_IDS', 'PASSE_SOFASCORE_TYPE_MAP', 'PASSE_SOFASCORE_INTERVAL_MS', 'PASSE_CACHE_TTL_MS'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passe-tm-enrich-'));
  const original = { id: 'tmdata-7', source: 'tmdata', name: 'Original', position: 'ST', leagueCountry: 'BR',
    club: 'Original club', marketValueEur: 100, stats: { goals: 0.8 }, minutes: 900, seasons: [] };
  fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify({ players: [original, { ...original, id: 'tmdata-8' }] }));
  let blocked = false;
  let calls = 0;
  const feedApp = express();
  feedApp.get('/players/:id', (_req, res) => {
    calls++;
    if (blocked) return res.status(403).json({ error: 'blocked' });
    res.json({ player: { id: '123', name: 'Should not overwrite', leagueCountry: 'PT', marketValueEur: 0,
      characteristics: { positive: ['dribbling'], negative: ['tackling'] },
      heatmap: { season: '2026', competition: 'Liga', points: [{ x: 70, y: 30, count: 2 }] } } });
  });
  const feed = await listen(feedApp);
  const server = await listen(createApp());
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    Object.assign(process.env, { PASSE_PROVIDERS: 'tmdata', PASSE_TMDATA_DIR: dir,
      PASSE_SOFASCORE_URL: `http://127.0.0.1:${feed.address().port}/`, PASSE_SOFASCORE_AUTHORIZED: 'true',
      PASSE_SOFASCORE_PLAYER_IDS: '{"tmdata-7":"123"}', PASSE_SOFASCORE_TYPE_MAP: '{}',
      PASSE_SOFASCORE_INTERVAL_MS: '1', PASSE_CACHE_TTL_MS: '1' });
    const search = () => fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ country: 'BR', position: 'ST', maxBudgetEur: 100, selectedCharacteristics: ['drible'] }) });
    const meta = await fetch(`${base}/api/meta`).then((r) => r.json());
    assert.equal(meta.characteristics.find((c) => c.code === 'drible').available, true);
    const response = await search();
    assert.equal(response.status, 200);
    const ranked = await response.json();
    assert.deepEqual(ranked.markets.interno.filter((p) => p.match.matched.length).map((p) => p.id), ['tmdata-7']);
    assert.equal(ranked.markets.interno[0].id, 'tmdata-7');
    assert.deepEqual(ranked.markets.interno[0].match.matched, ['drible']);
    const detail = await fetch(`${base}/api/players/tmdata-7`).then((r) => r.json());
    assert.equal(detail.source, 'tmdata');
    assert.equal(detail.name, 'Original');
    assert.equal(detail.club, 'Original club');
    assert.equal(detail.marketValueEur, 100);
    assert.equal(detail.leagueCountry, 'BR');
    assert.deepEqual(detail.characteristics, { positive: ['drible'], negative: ['desarme'], source: 'fonte', evaluable: null });
    assert.equal(detail.heatmap.points[0].x, 70);
    blocked = true;
    // Outra identidade explícita evita depender da expiração do cache do primeiro ID.
    process.env.PASSE_SOFASCORE_PLAYER_IDS = '{"tmdata-7":"124"}';
    const blockedResponse = await search();
    assert.equal(blockedResponse.status, 200);
    assert.ok(Object.values((await blockedResponse.json()).markets).flat().every((p) => p.match.matched.length === 0));
    const before = calls;
    await search();
    assert.equal(calls, before, 'não repete chamadas durante pausa do 403');
  } finally {
    await Promise.all([close(feed), close(server)]);
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
