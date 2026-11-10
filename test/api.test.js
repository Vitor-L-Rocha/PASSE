import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let server;
let base;
const query = { country: 'BR', maxBudgetEur: 5_000_000, position: 'ST', characteristics: '' };

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); });

async function search(patch = {}) {
  const response = await fetch(`${base}/api/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...query, ...patch }),
  });
  return { status: response.status, data: await response.json() };
}

test('meta descreve países, posições e mercados', async () => {
  const response = await fetch(`${base}/api/meta`);
  assert.equal(response.status, 200);
  const meta = await response.json();
  assert.ok(meta.countries.some((c) => c.code === 'BR' && c.continent === 'SA'));
  assert.ok(meta.positions.some((p) => p.code === 'ST'));
  assert.deepEqual(Object.keys(meta.markets), ['interno', 'externo', 'internacional']);
  assert.ok(meta.attributes && meta.continents);
});

test('valida orçamento, país, posição e limite do texto', async () => {
  for (const patch of [
    { maxBudgetEur: 0 }, { maxBudgetEur: -1 }, { maxBudgetEur: 'abc' },
    { country: 'ZZ' }, { position: 'ZZ' }, { characteristics: 'a'.repeat(1001) },
    { characteristics: null },
  ]) {
    const { status, data } = await search(patch);
    assert.equal(status, 400, JSON.stringify(patch));
    assert.ok(data.errors.length > 0);
  }
  for (const characteristics of ['', 'a'.repeat(1000)]) {
    assert.equal((await search({ characteristics })).status, 200);
  }
});

test('busca respeita liga, continente, orçamento e ranking; detalhe corresponde ao resumo', async () => {
  const meta = await (await fetch(`${base}/api/meta`)).json();
  const continents = new Map(meta.countries.map((c) => [c.code, c.continent]));
  let differentNationality = false;
  let count = 0;
  for (const country of ['BR', 'PT']) {
    const { status, data } = await search({ country, characteristics: 'finalizador, forte' });
    assert.equal(status, 200);
    for (const [market, players] of Object.entries(data.markets)) {
      assert.ok(players.length > 0, `${country}: ${market}`);
      for (const [i, player] of players.entries()) {
        count++;
        assert.equal(player.position, query.position);
        assert.ok(player.marketValueEur <= query.maxBudgetEur);
        assert.ok(player.fit >= 0 && player.fit <= 100);
        if (i) assert.ok(players[i - 1].fit >= player.fit);
        assert.ok(continents.has(player.leagueCountry));
        const expected = player.leagueCountry === country ? 'interno'
          : continents.get(player.leagueCountry) === continents.get(country) ? 'externo' : 'internacional';
        assert.equal(market, expected, JSON.stringify(player));
        assert.equal(player.market, expected);
        if (player.nationality !== player.leagueCountry) differentNationality = true;
      }
    }
    const first = Object.values(data.markets).flat()[0];
    const response = await fetch(`${base}/api/players/${encodeURIComponent(first.id)}`);
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.id, first.id);
    assert.equal(detail.leagueCountry, first.leagueCountry);
    assert.ok(detail.attributes && detail.stats);
  }
  assert.ok(count > 0 && differentNationality, 'fixture deve incluir nacionalidade diferente da liga');
  assert.equal((await fetch(`${base}/api/players/demo-999999`)).status, 404);
});

// Política: pés conflitantes não bloqueiam a busca; o filtro de pé é ignorado e a API devolve um aviso.
test('características conflitantes não são silenciosamente ignoradas', async () => {
  const { status, data } = await search({ characteristics: 'canhoto destro' });
  assert.equal(status, 200);
  assert.equal(data.criteria.filters.foot, undefined);
  assert.ok(data.criteria.warnings.some((w) => /conflitantes/.test(w)));
});
