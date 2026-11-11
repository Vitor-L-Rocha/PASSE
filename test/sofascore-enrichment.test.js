// Ponta a ponta: um jogador de outra fonte (demo) com ID SofaScore configurado recebe
// as características e o mapa de calor do feed AUTORIZADO, tanto no ranking quanto na ficha.
// O feed é simulado localmente; nada é consultado no SofaScore.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../src/server.js';

const ENV_KEYS = ['PASSE_SOFASCORE_URL', 'PASSE_SOFASCORE_AUTHORIZED', 'PASSE_SOFASCORE_PLAYER_IDS', 'PASSE_SOFASCORE_INTERVAL_MS', 'PASSE_CACHE_TTL_MS'];
const saved = {};
let feed, app, base, feedHits = 0;
const query = { country: 'BR', maxBudgetEur: 5_000_000, position: 'LW', characteristics: '', selectedCharacteristics: ['bolaParada'] };
const FEED_PLAYER = {
  id: '987654',
  characteristics: { positive: ['bolaParada', 'cruzamentos'], negative: ['duelosAereos'] },
  heatmap: { season: '2026', competition: 'Feed licenciado (teste)', points: [{ x: 70, y: 20, count: 4 }] },
  links: { sofascore: 'https://example.com/jogador/987654' },
};

const listen = (a) => new Promise((resolve) => { const s = a.listen(0, '127.0.0.1', () => resolve(s)); });
async function search() {
  const r = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(query) });
  return r.json();
}

before(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  const f = express();
  f.get('/players/:id', (req, res) => {
    feedHits++;
    res.json({ player: req.params.id === FEED_PLAYER.id ? FEED_PLAYER : null });
  });
  feed = await listen(f);
  app = await listen(createApp());
  base = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
  for (const k of ENV_KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  await Promise.all([feed, app].map((s) => new Promise((r) => s.close(r))));
});

test('sem feed configurado, nada é enriquecido e "bola parada" não aparece no demo', async () => {
  const d = await search();
  assert.equal(d.total, 0);
  assert.equal(feedHits, 0);
});

test('com feed autorizado e ID mapeado, ranking e ficha usam as características da fonte', async () => {
  // Escolhe um ponta do demo e associa ao ID do feed.
  const demo = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...query, selectedCharacteristics: [] }) }).then((r) => r.json());
  const target = Object.values(demo.markets).flat()[0];
  Object.assign(process.env, {
    PASSE_SOFASCORE_URL: `http://127.0.0.1:${feed.address().port}/`,
    PASSE_SOFASCORE_AUTHORIZED: 'true',
    PASSE_SOFASCORE_PLAYER_IDS: JSON.stringify({ [target.id]: FEED_PLAYER.id }),
    PASSE_SOFASCORE_INTERVAL_MS: '1',
    PASSE_CACHE_TTL_MS: '1',
  });

  const d = await search();
  const all = Object.values(d.markets).flat();
  assert.deepEqual(all.map((p) => p.id), [target.id], 'só o jogador enriquecido tem "bola parada"');
  assert.equal(all[0].characteristics.source, 'fonte');
  assert.deepEqual(all[0].match.matched, ['bolaParada']);

  const p = await fetch(`${base}/api/players/${encodeURIComponent(target.id)}`).then((r) => r.json());
  assert.equal(p.source, 'demo', 'identidade e fonte original preservadas');
  assert.deepEqual(p.characteristics.positive, ['bolaParada', 'cruzamentos']);
  assert.deepEqual(p.characteristics.negative, ['duelosAereos']);
  assert.equal(p.heatmap.competition, 'Feed licenciado (teste)');
  assert.ok(p.seasons.length > 0, 'temporadas da fonte original mantidas');
  assert.ok(feedHits > 0);
});
