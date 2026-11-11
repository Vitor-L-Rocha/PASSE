// Perfis parecidos, links por plataforma e ligação de IDs via Reep (arquivo sintético, offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { similarPlayers, profileDistance, comparablePositions } from '../src/core/similarity.js';
import { profileLinks } from '../src/providers/tmdataProvider.js';
import { buildIds } from '../scripts/sync-reep.js';
import { createApp } from '../src/server.js';

const mk = (id, position, stats, extra = {}) => ({ id, name: id, position, minutes: 2000, marketValueEur: 1_000_000, stats, ...extra });
const winger = { goals: 0.4, assists: 0.3, keyPasses: 2.2, dribbles: 3, tackles: 0.6, passAccuracy: 80, duelsWonPct: 50 };

test('perfil mais parecido vem primeiro; outra posição e amostra pequena ficam de fora', () => {
  const target = mk('alvo', 'LW', winger);
  const pool = [
    mk('quase-igual', 'RW', { ...winger, goals: 0.38 }),
    mk('diferente', 'LW', { goals: 0.05, assists: 0.02, keyPasses: 0.3, dribbles: 0.4, tackles: 2, passAccuracy: 88, duelsWonPct: 60 }),
    mk('zagueiro', 'CB', winger),
    mk('pouco-jogo', 'LW', winger, { minutes: 200 }),
    mk('caro', 'LW', winger, { marketValueEur: 50_000_000 }),
  ];
  const r = similarPlayers(target, pool, { maxBudgetEur: 10_000_000 });
  assert.deepEqual(r.map((x) => x.id), ['quase-igual', 'diferente']);
  assert.deepEqual(comparablePositions('LB'), ['LB', 'RB']);
  assert.equal(profileDistance(target, mk('x', 'LW', { goals: 0.4 })), null, 'poucas estatísticas em comum: não compara');
});

test('links de perfil só com IDs válidos', () => {
  const l = profileLinks('Vinícius Júnior', { sofascore: '868812', fotmob: '846033', fbref: '7111d552', whoscored: 'x<script>', understat: '7008' });
  assert.equal(l.sofascore, 'https://www.sofascore.com/football/player/vinicius-junior/868812');
  assert.equal(l.fotmob, 'https://www.fotmob.com/players/846033/vinicius-junior');
  assert.equal(l.fbref, 'https://fbref.com/en/players/7111d552/');
  assert.equal(l.whoscored, undefined, 'ID inválido é descartado');
  assert.equal(l.understat, 'https://understat.com/player/7008');
});

test('Reep: liga o ID do Transfermarkt aos IDs das outras plataformas, com confiança mínima', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passe-reep-'));
  const csv = [
    'reep_id,provider,namespace,external_id,entity_type,independence_bucket,route_scope,rule_id,confidence,attached_at',
    'rp1,api_football,player,762,player,NONE,x,y,1.0,',
    'rp1,sofascore,player,868812,player,NONE,x,y,0.99,',
    'rp1,fotmob,person,846033,player,NONE,x,y,0.5,', // confiança baixa: ignorado
    'rp1,transfermarkt,spieler,371998,player,NONE,x,y,1.0,',
    'rp2,transfermarkt,spieler,999,player,NONE,x,y,1.0,', // fora do índice
    'rp2,api_football,player,1,player,NONE,x,y,1.0,',
    'a1,api_football,award,1,award,NONE,x,y,1.0,',
  ].join('\n');
  const file = path.join(dir, 'bridges.csv.gz');
  fs.writeFileSync(file, zlib.gzipSync(csv));
  try {
    const ids = await buildIds({ bridgesFile: file, tmIds: new Set(['371998']), log: () => {} });
    assert.deepEqual(ids, { 'tmdata-371998': { apiFootball: '762', sofascore: '868812' } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('API: perfis parecidos respeitam teto e posição; jogador inexistente dá 404', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const search = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ country: 'BR', maxBudgetEur: 5_000_000, position: 'LW', characteristics: '' }) }).then((r) => r.json());
    const target = Object.values(search.markets).flat()[0];
    const d = await fetch(`${base}/api/players/${target.id}/similar?teto=3000000`).then((r) => r.json());
    assert.ok(d.similar.length > 0);
    for (const s of d.similar) {
      assert.ok(['LW', 'RW'].includes(s.position));
      assert.ok(s.marketValueEur <= 3_000_000);
      assert.notEqual(s.id, target.id);
      assert.equal(s.fit, undefined, 'sem nota');
    }
    assert.equal((await fetch(`${base}/api/players/demo-999999/similar`)).status, 404);
    assert.equal((await fetch(`${base}/api/players/${target.id}/similar?teto=abc`)).status, 400);
  } finally {
    server.close();
  }
});
