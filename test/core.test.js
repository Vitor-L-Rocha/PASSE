import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCriteria } from '../src/core/criteria.js';
import { classifyMarket } from '../src/core/markets.js';
import { rankPlayers } from '../src/core/matcher.js';
import { generateDemoPlayers } from '../src/data/demoDataset.js';
import { createApp } from '../src/server.js';

test('parseCriteria reconhece características, pé, idade e altura', () => {
  const c = parseCriteria('Rápido, canhoto, bom no jogo aéreo, sub-21, acima de 1,85');
  assert.ok(c.traits.includes('Velocidade'));
  assert.ok(c.traits.includes('Duelos aéreos'));
  assert.deepEqual(c.characteristics, ['duelosAereos', 'velocidade']);
  assert.equal(c.filters.foot, 'esquerdo');
  assert.equal(c.filters.maxAge, 21);
  assert.equal(c.filters.minHeightCm, 186); // "acima de" é estrito
});

test('parseCriteria: pés conflitantes não filtram e geram aviso', () => {
  const c = parseCriteria('canhoto destro');
  assert.equal(c.filters.foot, undefined);
  assert.equal(c.warnings.length, 1);
  assert.equal(parseCriteria('ambidestro').filters.foot, 'ambidestro');
});

test('parseCriteria: "jovem" vira idade máxima 23 e texto vazio não gera filtros', () => {
  assert.equal(parseCriteria('jovem promessa').filters.maxAge, 23);
  assert.deepEqual(parseCriteria('').filters, {});
});

test('classifyMarket usa o país da liga', () => {
  assert.equal(classifyMarket('BR', 'BR'), 'interno');
  assert.equal(classifyMarket('BR', 'AR'), 'externo');
  assert.equal(classifyMarket('BR', 'PT'), 'internacional');
  assert.equal(classifyMarket('PT', 'ES'), 'externo');
});

test('rankPlayers respeita orçamento, posição e filtros, e ordena por aderência', () => {
  const players = generateDemoPlayers();
  const criteria = parseCriteria('canhoto, rápido, até 25 anos');
  const r = rankPlayers(players, { country: 'BR', maxBudgetEur: 2_000_000, position: 'LW', criteria });
  const all = Object.values(r.markets).flat();
  assert.ok(all.length > 0);
  for (const p of all) {
    assert.equal(p.position, 'LW');
    assert.ok(p.marketValueEur <= 2_000_000);
    assert.ok(p.age <= 25);
    assert.ok(['esquerdo', 'ambidestro'].includes(p.foot));
  }
  for (const list of Object.values(r.markets)) {
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].match.matched.length >= list[i].match.matched.length);
    for (const p of list) assert.equal(p.fit, undefined);
  }
  for (const p of r.markets.interno) assert.equal(p.leagueCountry, 'BR');
});

test('API: busca e detalhe do jogador', async () => {
  const server = createApp().listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    const bad = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(bad.status, 400);

    const res = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ country: 'BR', maxBudgetEur: 5_000_000, position: 'ST', characteristics: 'finalizador, forte' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(Object.keys(data.markets), ['interno', 'externo', 'internacional']);
    const first = Object.values(data.markets).flat()[0];
    const det = await fetch(`${base}/api/players/${first.id}`);
    assert.equal(det.status, 200);
    const p = await det.json();
    assert.equal(p.id, first.id);
    assert.ok(p.characteristics && p.stats);

    assert.equal((await fetch(`${base}/api/players/demo-999999`)).status, 404);
  } finally {
    server.close();
  }
});
