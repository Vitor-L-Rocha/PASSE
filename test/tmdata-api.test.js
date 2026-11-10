// Índice mínimo fictício: exercita o provedor real sem depender do índice local ou da rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

test('API tmdata: mercados, filtros, características ignoradas e ficha', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passe-tmdata-api-'));
  const previous = { providers: process.env.PASSE_PROVIDERS, dir: process.env.PASSE_TMDATA_DIR };
  const basePlayer = { source: 'tmdata', name: 'Jogador do teste', position: 'ST', age: 22, foot: 'esquerdo', marketValueEur: 100, minutes: 900, stats: { goals: 0.8, assists: 0.1 }, seasons: [] };
  const players = [
    { ...basePlayer, id: 'tmdata-1', name: 'Com dados', nationality: 'PT', leagueCountry: 'BR' },
    { ...basePlayer, id: 'tmdata-2', name: 'Sem dados', nationality: 'BR', leagueCountry: 'BR', minutes: null, stats: {} },
    { ...basePlayer, id: 'tmdata-3', nationality: 'BR', leagueCountry: 'AR' },
    { ...basePlayer, id: 'tmdata-4', nationality: 'BR', leagueCountry: 'PT' },
    { ...basePlayer, id: 'tmdata-5', nationality: 'BR', leagueCountry: 'US' },
    { ...basePlayer, id: 'tmdata-6', leagueCountry: 'BR', marketValueEur: 101 },
    { ...basePlayer, id: 'tmdata-7', leagueCountry: 'BR', age: 24 },
    { ...basePlayer, id: 'tmdata-8', leagueCountry: 'BR', foot: 'direito' },
  ];
  fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify({ source: { license: 'CC0 1.0' }, players }));
  process.env.PASSE_PROVIDERS = 'tmdata';
  process.env.PASSE_TMDATA_DIR = dir;
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const meta = await (await fetch(`${base}/api/meta`)).json();
    assert.equal(meta.sources[0].name, 'tmdata');
    assert.equal(meta.characteristics.find((c) => c.code === 'drible').available, false);
    for (const country of ['BR', 'PT', 'US']) {
      const response = await fetch(`${base}/api/search`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ country, position: 'ST', maxBudgetEur: 100, characteristics: 'canhoto até 23 anos', selectedCharacteristics: ['finalizacao', 'drible'] }),
      });
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.deepEqual(data.ignored, ['drible']);
      assert.deepEqual(data.desired, ['finalizacao']);
      const locations = { BR: country === 'BR' ? 'interno' : 'internacional', AR: country === 'BR' ? 'externo' : 'internacional', PT: country === 'PT' ? 'interno' : 'internacional', US: country === 'US' ? 'interno' : 'internacional' };
      const all = Object.values(data.markets).flat();
      assert.equal(all.length, 5);
      for (const [market, list] of Object.entries(data.markets)) {
        let seenNoData = false;
        for (const player of list) {
          assert.equal(market, locations[player.leagueCountry]);
          assert.ok(player.marketValueEur <= 100 && player.age <= 23 && player.foot === 'esquerdo');
          if (player.match.noData) seenNoData = true;
          else assert.equal(seenNoData, false);
        }
      }
      assert.equal(all.find((p) => p.id === 'tmdata-2').match.noData, true);
    }
    for (const [id, source] of [['tmdata-1', 'estatisticas'], ['tmdata-2', 'indisponivel']]) {
      const response = await fetch(`${base}/api/players/${id}`);
      assert.equal(response.status, 200);
      const player = await response.json();
      assert.equal(player.id, id);
      assert.equal(player.characteristics.source, source);
    }
    assert.equal((await fetch(`${base}/api/players/tmdata-unknown`)).status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    if (previous.providers === undefined) delete process.env.PASSE_PROVIDERS; else process.env.PASSE_PROVIDERS = previous.providers;
    if (previous.dir === undefined) delete process.env.PASSE_TMDATA_DIR; else process.env.PASSE_TMDATA_DIR = previous.dir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
