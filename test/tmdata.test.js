// Provedor de dados reais: lê um índice no formato gerado por scripts/sync-data.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { tmdataProvider } from '../src/providers/tmdataProvider.js';
import { parseCsv } from '../scripts/sync-data.js';
import { deriveCharacteristics } from '../src/core/characteristics.js';

test('parser CSV lida com aspas, vírgulas, aspas escapadas, quebras de linha e campos vazios', async () => {
  const csv = 'a,b,c\n"x, y","diz ""oi""",\n1,,"linha\nnova"\n';
  const rows = [];
  for await (const r of parseCsv(Readable.from([Buffer.from(csv)]))) rows.push(r);
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'diz "oi"', ''], ['1', '', 'linha\nnova']]);
});

test('tmdata: busca por posição/orçamento, detalhe por id e desabilitado sem índice', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passe-tmdata-'));
  const prev = process.env.PASSE_TMDATA_DIR;
  process.env.PASSE_TMDATA_DIR = dir;
  try {
    assert.equal(tmdataProvider.isEnabled(), false);
    await assert.rejects(tmdataProvider.searchPlayers({}), /sync-data/);
    const players = [
      { id: 'tmdata-1', source: 'tmdata', name: 'A', position: 'ST', marketValueEur: 1_000_000, leagueCountry: 'BR', minutes: 2000, stats: { goals: 0.6, assists: 0.1 } },
      { id: 'tmdata-2', source: 'tmdata', name: 'B', position: 'ST', marketValueEur: null, leagueCountry: 'BR' },
      { id: 'tmdata-3', source: 'tmdata', name: 'C', position: 'CB', marketValueEur: 500_000, leagueCountry: 'PT' },
    ];
    fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify({ source: { license: 'CC0 1.0' }, players }));
    assert.equal(tmdataProvider.isEnabled(), true);
    assert.deepEqual((await tmdataProvider.searchPlayers({ position: 'st', maxBudgetEur: 2_000_000 })).map((p) => p.id), ['tmdata-1']);
    assert.equal((await tmdataProvider.getPlayer('tmdata-3')).name, 'C');
    assert.equal(await tmdataProvider.getPlayer('tmdata-9'), null);
    assert.equal(tmdataProvider.info().players, 3);
    // Só gols/assistências: "finalização" pode ser derivada; drible/desarme não.
    const c = deriveCharacteristics(players[0]);
    assert.ok(c.positive.includes('finalizacao'));
    assert.ok(!c.positive.includes('drible'));
  } finally {
    if (prev === undefined) delete process.env.PASSE_TMDATA_DIR; else process.env.PASSE_TMDATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
